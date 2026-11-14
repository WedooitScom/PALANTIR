/* App: SSE connection, state, and all the HTML panels around the map. */
(function () {
  'use strict';

  const { Scene, STATUS, roleAvatar, modelInfo } = window.LOTRScene;
  const TERR = window.LOTRMap.TERR_BY_KEY;
  const Sprites = window.Sprites;

  const $ = (s) => document.querySelector(s);
  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  const MAX_FEED = 200;
  const ROLE_LABEL = {
    hobbit: 'Hobbit (session)', dwarf: 'Nain', wizard: 'Magicien', scout: 'Elfe éclaireur', painter: 'Elfe artiste', troll: 'Troll',
  };
  const STATUS_FR = {
    coding: 'Forge du code', thinking: 'Réfléchit', running: 'Lance des commandes', designing: 'Dessine',
    talking: 'Parlemente', waiting: 'Attend ta réponse', idle: 'Au repos', done: 'Parti',
  };
  const COUNCIL_KIND = { spawn: 'Envoi en mission', return: 'Rapport de mission', message: 'Message' };

  const state = {
    agents: new Map(),
    chronicle: [],
    council: [],
    demo: false,
    filter: '',
    tab: 'chronicle',
    detail: null, // { type: 'agent', id } | { type: 'territory', key }
    dismissed: new Set(),
    knownWaiting: new Set(),
    usage: { real: null, demo: null },
  };
  // Inside the macOS app (WKUserScript): native notifications replace the Web ones.
  const NATIVE = !!(window.LOTRNative && window.LOTRNative.app && window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.lotr);

  const prefs = (() => {
    const d = { sound: true, music: false, night: true, legend: true, side: true };
    try {
      return Object.assign(d, JSON.parse(localStorage.getItem('lotr-prefs') || '{}'));
    } catch {
      return d;
    }
  })();
  function savePrefs() {
    try {
      localStorage.setItem('lotr-prefs', JSON.stringify(prefs));
    } catch {
      /* ignore */
    }
  }

  // ------------------------------------------------------------ helpers

  const fmtTime = (t) => new Date(t).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  function since(t) {
    const s = Math.max(0, Math.round((Date.now() - t) / 1000));
    if (s < 60) return `${s} s`;
    const m = Math.floor(s / 60);
    if (m < 60) return `${m} min`;
    return `${Math.floor(m / 60)} h ${m % 60} min`;
  }
  function label(a) {
    return a.kind === 'subagent' ? `${a.project} · ${a.subagentType}` : a.project;
  }
  const dec = (n, d) => n.toFixed(d).replace('.', ',');
  /** 950 · 1,2 k · 3,4 M · 1,1 G */
  function fmtTok(n) {
    n = Number(n) || 0;
    if (n < 1000) return String(Math.round(n));
    if (n < 1e6) return `${dec(n / 1e3, n < 1e4 ? 1 : 0)} k`;
    if (n < 1e9) return `${dec(n / 1e6, n < 1e7 ? 1 : 0)} M`;
    return `${dec(n / 1e9, 1)} G`;
  }
  const fmtUsd = (v) => `${dec(Number(v) || 0, 2)} $`;
  function fmtDur(ms) {
    const s = Math.max(0, Math.round((Number(ms) || 0) / 1000));
    if (s < 60) return `${s} s`;
    const m = Math.floor(s / 60);
    if (m < 60) return `${m} min`;
    return `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')}`;
  }
  /** Countdown to an epoch (seconds): "1 h 26", "12 min", "3 j 4 h". */
  function fmtLeft(epochS) {
    const s = Math.round(epochS - Date.now() / 1000);
    if (s <= 0) return null;
    if (s < 60) return `${s} s`;
    const m = Math.floor(s / 60);
    if (m < 60) return `${m} min`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h} h ${String(m % 60).padStart(2, '0')}`;
    return `${Math.floor(h / 24)} j ${h % 24} h`;
  }
  const pctTxt = (p) => `${Math.round(p)} %`;
  /** Limits to display: the real ones when we have them, otherwise the demo ones (flagged). */
  function currentLimits() {
    for (const k of ['real', 'demo']) {
      const u = state.usage[k];
      if (u && (u.five || u.seven)) return u;
    }
    return null;
  }
  function currentToday() {
    for (const k of ['real', 'demo']) {
      const u = state.usage[k];
      if (u && u.today && (u.today.tokens || u.today.costUsd != null)) return u;
    }
    return null;
  }
  function isActive(a) {
    return a.status !== 'done';
  }

  // ------------------------------------------------------------ scene

  const tooltip = $('#tooltip');
  const scene = new Scene($('#map'), {
    onPick(hit) {
      if (!hit) return closeDetail();
      if (hit.type === 'agent' || hit.type === 'lantern' || hit.type === 'model') openDetail({ type: 'agent', id: hit.id });
      else {
        const s = [...state.agents.values()].find((a) => a.kind === 'session' && isActive(a) && a.territory === hit.key);
        openDetail(s ? { type: 'agent', id: s.id } : { type: 'territory', key: hit.key });
      }
    },
    onHover(hit, x, y) {
      if (!hit) {
        tooltip.hidden = true;
        return;
      }
      let text = '';
      if (hit.type === 'lantern' || hit.type === 'model') {
        const a = state.agents.get(hit.id);
        if (!a) return;
        if (hit.type === 'lantern') {
          const p = a.usage && a.usage.contextPct;
          text = `Lanterne de ${a.project} : ${pctTxt(p)} du contexte utilisé\nPleine et vive quand le sac est presque vide, elle faiblit à mesure qu'il se remplit.`;
        } else {
          const m = modelInfo(a);
          text = `Modèle de ${a.project} : ${m ? m.full : 'inconnu'}`;
        }
      } else if (hit.type === 'agent') {
        const a = state.agents.get(hit.id);
        if (!a) return;
        text = `${label(a)} — ${ROLE_LABEL[roleAvatar(a.role)]}\n${STATUS_FR[a.status] || a.status}${a.lastAction ? ' · ' + a.lastAction : ''}`;
      } else {
        const T = TERR[hit.key];
        const here = [...state.agents.values()].filter((a) => a.kind === 'session' && isActive(a) && a.territory === hit.key);
        text = `${T ? T.name : hit.key}\n${here.length ? here.map((a) => a.project).join(', ') : 'Terre inoccupée (brume)'}`;
      }
      tooltip.textContent = text;
      tooltip.hidden = false;
      const r = $('#mapWrap').getBoundingClientRect();
      const tx = Math.min(x - r.left + 14, r.width - tooltip.offsetWidth - 8);
      const ty = Math.min(y - r.top + 14, r.height - tooltip.offsetHeight - 8);
      tooltip.style.left = Math.max(4, tx) + 'px';
      tooltip.style.top = Math.max(4, ty) + 'px';
    },
  });
  scene.setAgents(state.agents);
  scene.nightEnabled = prefs.night;

  // ------------------------------------------------------------ SSE

  const conn = $('#conn');
  function setConn(ok) {
    conn.textContent = ok ? '● En ligne' : '● Reconnexion…';
    conn.className = 'conn ' + (ok ? 'ok' : 'ko');
  }

  function connect() {
    const es = new EventSource('stream');
    const on = (name, fn) => es.addEventListener(name, (m) => {
      try {
        fn(JSON.parse(m.data));
      } catch (e) {
        console.error('[lotr]', name, e);
      }
    });
    on('snapshot', applySnapshot);
    on('agent', (a) => {
      state.agents.set(a.id, a);
      scheduleUI();
    });
    on('remove', (d) => {
      state.agents.delete(d.id);
      scheduleUI();
    });
    on('log', (entry) => addLog(entry));
    on('fx', (fx) => scene.addFlight(fx));
    on('usage', (u) => {
      state.usage = u || { real: null, demo: null };
      renderReserves();
      renderSummary();
    });
    on('demo', (d) => setDemo(d.on));
    es.onopen = () => setConn(true);
    es.onerror = () => setConn(false);
  }

  function applySnapshot(snap) {
    state.agents.clear();
    for (const a of snap.agents || []) state.agents.set(a.id, a);
    state.chronicle = (snap.chronicle || []).slice(-MAX_FEED);
    state.council = (snap.council || []).slice(-MAX_FEED);
    state.usage = snap.usage || { real: null, demo: null };
    setDemo(!!snap.demo);
    renderReserves();
    renderFeeds();
    scheduleUI();
  }

  let uiPending = false;
  function scheduleUI() {
    if (uiPending) return;
    uiPending = true;
    requestAnimationFrame(() => {
      uiPending = false;
      renderSummary();
      renderAlerts();
      renderFilter();
      renderDetail();
      $('#empty').hidden = [...state.agents.values()].some((a) => a.kind === 'session' && isActive(a));
    });
  }

  // ------------------------------------------------------------ summary

  function renderSummary() {
    const act = [...state.agents.values()].filter(isActive);
    const count = (st) => act.filter((a) => a.status === st).length;
    const chips = [
      ['🏰', act.filter((a) => a.kind === 'session').length, 'compagnies'],
      ['👥', act.length, 'agents actifs'],
      ['⚒', count('coding'), 'codent'],
      ['🧙', count('thinking'), 'réfléchissent'],
      ['🪨', count('running'), 'commandes'],
      ['🎨', count('designing'), 'dessinent'],
      ['🔥', count('waiting'), 'en attente'],
    ];
    const box = $('#summary');
    const nodes = chips.map(([icon, n, txt]) => {
      const c = el('span', 'chip' + (icon === '🔥' && n > 0 ? ' hot' : ''));
      c.append(el('span', 'chip-icon', icon), el('b', null, String(n)), el('span', 'chip-txt', ' ' + txt));
      return c;
    });
    // Today's usage, all sessions (since local midnight).
    const u = currentToday();
    if (u) {
      const t = u.today;
      const demo = u.demo ? ' (démo)' : '';
      if (t.tokens) {
        const c = el('span', 'chip usage');
        c.append(el('span', 'chip-icon', '🪙'), el('b', null, fmtTok(t.tokens.total)), el('span', 'chip-txt', ' jetons du jour' + demo));
        c.title = `Jetons utilisés aujourd'hui, toutes sessions confondues${demo}\n`
          + `Entrée ${fmtTok(t.tokens.input)} · sortie ${fmtTok(t.tokens.output)}\n`
          + `Cache créé ${fmtTok(t.tokens.cacheCreation)} · cache lu ${fmtTok(t.tokens.cacheRead)}\n(d'après les transcripts de Claude Code)`;
        nodes.push(c);
      }
      if (t.costUsd != null) {
        const c = el('span', 'chip usage');
        c.append(el('span', 'chip-icon', '💰'), el('b', null, fmtUsd(t.costUsd)), el('span', 'chip-txt', ' aujourd\'hui' + demo));
        c.title = `Coût cumulé des ${t.costSessions} session(s) vues aujourd'hui, d'après Claude Code${demo}`;
        nodes.push(c);
      }
    }
    box.replaceChildren(...nodes);
  }

  // ------------------------------------------------------------ reserves (5 h / 7 day limits)

  const GAUGES = {
    five: { node: $('#gFive'), name: 'Lembas', what: 'la limite d\'usage de Claude sur 5 heures glissantes' },
    seven: { node: $('#gSeven'), name: 'Greniers', what: 'la limite d\'usage de Claude sur 7 jours' },
  };
  function renderReserves() {
    const box = $('#reserves');
    const u = currentLimits();
    box.classList.toggle('demo', !!(u && u.demo));
    if (!u) {
      box.setAttribute('data-empty', '');
      box.title = 'Réserves du royaume : en attente de la status line de Claude Code.\nInstalle-la avec « npm run install-statusline ».';
      scene.usage = null;
      return;
    }
    box.removeAttribute('data-empty');
    box.title = '';
    for (const [k, g] of Object.entries(GAUGES)) {
      const w = u[k];
      g.node.hidden = !w || w.pct == null;
      if (g.node.hidden) continue;
      const pct = Math.max(0, w.pct);
      const left = w.resetsAt ? fmtLeft(w.resetsAt) : null;
      const expired = w.resetsAt && !left;
      g.node.classList.toggle('warn', !expired && pct >= 70 && pct < 90);
      g.node.classList.toggle('crit', !expired && pct >= 90);
      g.node.querySelector('.g-fill').style.width = (expired ? 0 : Math.min(100, pct)) + '%';
      g.node.querySelector('.g-val').textContent = expired ? 'reconstituées' : `${pctTxt(pct)}${left ? ' · ' + left : ''}`;
      const at = w.resetsAt ? new Date(w.resetsAt * 1000).toLocaleString('fr-FR', { weekday: k === 'seven' ? 'short' : undefined, hour: '2-digit', minute: '2-digit' }) : null;
      g.node.title = `${g.name} : ${g.what}.\n`
        + (expired ? 'La fenêtre est écoulée : les réserves sont reconstituées (en attente d\'une nouvelle mesure).'
          : `${pctTxt(pct)} utilisés${left ? ` — reset dans ${left} (à ${at})` : ''}.`)
        + '\nVert, puis jaune à 70 %, rouge à 90 %. Source : status line de Claude Code' + (u.demo ? ' (valeurs de démo).' : '.');
    }
    const five = u.five && u.five.pct != null && !(u.five.resetsAt && !fmtLeft(u.five.resetsAt)) ? u.five.pct : 0;
    scene.usage = { fivePct: five };
  }
  setInterval(renderReserves, 1000);

  // ------------------------------------------------------------ alerts

  const Sound = window.LOTRAudio;
  function beep() {
    if (prefs.sound) Sound.beep();
  }

  function notify(a) {
    beep();
    if (NATIVE) return; // the macOS app already sends a native notification for this wait
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    if (!document.hidden && document.hasFocus()) return;
    try {
      const n = new Notification(`🔥 ${label(a)} attend ta réponse`, { body: (a.waiting && a.waiting.message) || '', tag: a.id });
      n.onclick = () => {
        window.focus();
        openDetail({ type: 'agent', id: a.id });
      };
    } catch {
      /* ignore */
    }
  }

  const toastNodes = new Map();
  function renderAlerts() {
    const waiting = [...state.agents.values()].filter((a) => a.status === 'waiting').sort((p, q) => ((p.waiting && p.waiting.since) || 0) - ((q.waiting && q.waiting.since) || 0));
    const keys = new Set();
    for (const a of waiting) {
      const key = a.id + ':' + ((a.waiting && a.waiting.since) || 0);
      keys.add(key);
      if (!state.knownWaiting.has(key)) notify(a);
    }
    state.knownWaiting = keys;
    Sound.music.setTension(waiting.length > 0);
    for (const k of [...state.dismissed]) if (!keys.has(k)) state.dismissed.delete(k);

    // Reconcile toasts in place (keeps buttons clickable while "depuis" ticks).
    const box = $('#alerts');
    const visible = waiting.filter((a) => !state.dismissed.has(a.id + ':' + ((a.waiting && a.waiting.since) || 0)));
    const want = new Set();
    for (const a of visible) {
      const key = a.id + ':' + ((a.waiting && a.waiting.since) || 0);
      want.add(key);
      let t = toastNodes.get(key);
      if (!t) {
        t = el('div', 'toast');
        const beacon = el('canvas', 'toast-icon');
        Sprites.drawIcon(beacon, 'beacon', 0.1, 1.5);
        const txt = el('div', 'toast-txt');
        const title = el('div', 'toast-title');
        title.append(el('b', null, label(a)), document.createTextNode(' attend ta réponse'));
        txt.append(title, el('div', 'toast-msg', (a.waiting && a.waiting.message) || 'Les feux d\'alarme sont allumés !'), el('div', 'toast-meta'));
        const see = el('button', 'btn small', 'Voir');
        see.onclick = () => openDetail({ type: 'agent', id: a.id });
        const x = el('button', 'btn small ghost', '×');
        x.title = 'Masquer cette alerte';
        x.onclick = () => {
          state.dismissed.add(key);
          renderAlerts();
        };
        t.append(beacon, txt, see, x);
        toastNodes.set(key, t);
        box.append(t);
      }
      t.querySelector('.toast-meta').textContent = `${TERR[a.territory] ? TERR[a.territory].name : ''} · depuis ${since((a.waiting && a.waiting.since) || Date.now())}`;
    }
    for (const [key, node] of toastNodes) {
      if (!want.has(key)) {
        node.remove();
        toastNodes.delete(key);
      }
    }
    let count = box.querySelector('.alerts-count');
    if (visible.length > 1) {
      if (!count) {
        count = el('div', 'alerts-count');
        box.prepend(count);
      }
      count.textContent = `${visible.length} balises allumées`;
    } else if (count) count.remove();
    document.title = waiting.length ? `(${waiting.length}) 🔥 Carte de la Terre du Milieu` : 'Carte de la Terre du Milieu';
  }
  setInterval(() => {
    if ([...state.agents.values()].some((a) => a.status === 'waiting')) renderAlerts();
  }, 1000);

  // ------------------------------------------------------------ feeds

  function matches(entry) {
    return !state.filter || entry.sessionId === state.filter;
  }

  function chronicleItem(e) {
    const li = el('li', 'item kind-' + e.kind);
    li.append(el('time', null, fmtTime(e.t)), el('span', 'icon', e.icon || '•'), el('span', 'txt', e.text));
    if (e.agentId) li.onclick = () => state.agents.has(e.agentId) && openDetail({ type: 'agent', id: e.agentId });
    return li;
  }

  function councilItem(e) {
    const li = el('li', 'letter kind-' + e.kind);
    const head = el('div', 'head');
    head.append(el('span', 'icon', e.icon || '✉'), el('span', 'kind', COUNCIL_KIND[e.kind] || e.kind), el('time', null, fmtTime(e.t)));
    const route = el('div', 'route');
    route.append(el('b', null, e.from || '?'), document.createTextNode(' → '), el('b', null, e.to || '?'));
    li.append(head, route, el('div', 'title', e.text));
    if (e.body) li.append(el('div', 'body', e.body));
    if (e.agentId) li.onclick = () => state.agents.has(e.agentId) && openDetail({ type: 'agent', id: e.agentId });
    return li;
  }

  function renderFeeds() {
    const ch = $('#chronicle');
    const co = $('#council');
    ch.replaceChildren(...state.chronicle.filter(matches).slice(-MAX_FEED).reverse().map(chronicleItem));
    co.replaceChildren(...state.council.filter(matches).slice(-MAX_FEED).reverse().map(councilItem));
    if (!ch.children.length) ch.append(el('li', 'feed-empty', 'La chronique est encore vierge… Lance le mode démo ou une session Claude Code.'));
    if (!co.children.length) co.append(el('li', 'feed-empty', 'Aucun conseil ne s\'est encore réuni.'));
  }

  function addLog(entry) {
    const list = entry.channel === 'council' ? state.council : state.chronicle;
    list.push(entry);
    if (list.length > MAX_FEED * 1.5) list.splice(0, list.length - MAX_FEED);
    if (!matches(entry)) return;
    const box = entry.channel === 'council' ? $('#council') : $('#chronicle');
    const empty = box.querySelector('.feed-empty');
    if (empty) empty.remove();
    const node = entry.channel === 'council' ? councilItem(entry) : chronicleItem(entry);
    node.classList.add('fresh');
    box.prepend(node);
    while (box.children.length > MAX_FEED) box.lastChild.remove();
  }

  let filterSig = '';
  function renderFilter() {
    const sessions = [...state.agents.values()].filter((a) => a.kind === 'session').sort((p, q) => p.project.localeCompare(q.project));
    const sig = sessions.map((s) => s.id + s.project).join('|') + '#' + state.filter;
    if (sig === filterSig) return;
    filterSig = sig;
    const sel = $('#filter');
    const opts = [el('option', null, 'Toutes les compagnies')];
    opts[0].value = '';
    for (const s of sessions) {
      const o = el('option', null, s.project + (s.status === 'done' ? ' (partie)' : ''));
      o.value = s.id;
      opts.push(o);
    }
    if (state.filter && !sessions.some((s) => s.id === state.filter)) {
      const o = el('option', null, '(compagnie disparue)');
      o.value = state.filter;
      opts.push(o);
    }
    sel.replaceChildren(...opts);
    sel.value = state.filter;
  }

  $('#filter').addEventListener('change', (ev) => {
    state.filter = ev.target.value;
    filterSig = '';
    renderFeeds();
    renderFilter();
  });

  document.querySelectorAll('.tab').forEach((b) => {
    b.addEventListener('click', () => {
      state.tab = b.dataset.tab;
      document.querySelectorAll('.tab').forEach((x) => x.classList.toggle('active', x === b));
      $('#chronicle').hidden = state.tab !== 'chronicle';
      $('#council').hidden = state.tab !== 'council';
    });
  });

  // ------------------------------------------------------------ detail panel

  function openDetail(d) {
    state.detail = d;
    scene.selected = d && d.type === 'agent' ? d.id : null;
    renderDetail();
  }
  function closeDetail() {
    state.detail = null;
    scene.selected = null;
    $('#detail').hidden = true;
  }

  function dl(rows) {
    const box = el('dl');
    for (const [k, v, cls] of rows) {
      if (v == null || v === '') continue;
      box.append(el('dt', null, k));
      const dd = el('dd', cls || null);
      if (v instanceof Node) dd.append(v);
      else dd.textContent = v;
      box.append(dd);
    }
    return box;
  }

  function renderDetail() {
    const panel = $('#detail');
    const d = state.detail;
    if (!d) {
      panel.hidden = true;
      return;
    }
    const body = $('#detailBody');
    const head = $('#detailHead');
    const icon = $('#detailIcon');
    if (d.type === 'territory') {
      const T = TERR[d.key];
      head.replaceChildren(el('h2', null, T ? T.name : d.key), el('div', 'sub', 'Terre inoccupée'));
      Sprites.drawIcon(icon, 'campfire', 0, 2);
      body.replaceChildren(el('p', 'muted', 'La brume recouvre ces terres : aucune compagnie n\'y campe pour le moment. Elle sera attribuée à la prochaine session Claude Code.'));
      panel.hidden = false;
      return;
    }
    const a = state.agents.get(d.id);
    if (!a) {
      head.replaceChildren(el('h2', null, 'Disparu'), el('div', 'sub', 'Cet agent a quitté la carte.'));
      body.replaceChildren();
      panel.hidden = false;
      return;
    }
    const T = TERR[a.territory];
    const avatar = roleAvatar(a.role);
    Sprites.drawIcon(icon, avatar === 'hobbit' ? 'hobbit' : avatar, performance.now() / 1000, 2);
    const sub = `${ROLE_LABEL[avatar]}${a.subagentType ? ' · ' + a.subagentType : ''}${T ? ' · ' + T.name : ''}`;
    head.replaceChildren(el('h2', null, a.project), el('div', 'sub', sub));

    const st = STATUS[a.status] || STATUS.idle;
    const badge = el('span', 'badge', STATUS_FR[a.status] || a.status);
    badge.style.background = st.color;

    const counters = Object.entries(a.counters || {}).sort((p, q) => q[1] - p[1]).slice(0, 8);
    const ctr = el('div', 'counters');
    for (const [k, n] of counters) ctr.append(el('span', 'ctr', `${k.replace(/^mcp__/, '🔮')} ×${n}`));

    const rows = [
      ['Statut', badge],
      a.waiting ? ['En attente', `${a.waiting.message} (depuis ${since(a.waiting.since)})`, 'warn'] : null,
      ['Dossier', a.cwd, 'mono'],
      a.kind === 'session' ? ['Dernier prompt', a.lastPrompt ? `« ${a.lastPrompt} »` : '—'] : null,
      a.kind === 'subagent' ? ['Mission', a.description] : null,
      a.kind === 'subagent' ? ['Ordres', a.prompt] : null,
      a.kind === 'subagent' && a.result ? ['Rapport', a.result] : null,
      ['Dernière action', a.lastAction ? `${a.lastAction} (il y a ${since(a.lastActionAt)})` : '—'],
      ['Outils', counters.length ? ctr : 'Aucun pour l\'instant'],
      ['Arrivée', fmtTime(a.startedAt)],
    ].filter(Boolean);
    const parts = [dl(rows)];
    const usage = usageRows(a);
    if (usage.length) parts.push(el('h3', null, 'Provisions (usage)'), dl(usage));

    if (a.kind === 'subagent') {
      const parent = state.agents.get(a.parentId) || state.agents.get(a.sessionId);
      if (parent) {
        const b = el('button', 'btn small', `← ${label(parent)}`);
        b.onclick = () => openDetail({ type: 'agent', id: parent.id });
        parts.push(b);
      }
    }

    if (a.kind === 'session') {
      parts.push(el('h3', null, `Sous-agents (${(a.subagents || []).length})`));
      const ul = el('ul', 'subs');
      for (const s of a.subagents || []) {
        const li = el('li', 'sub-' + s.status);
        const live = state.agents.get(s.id);
        li.append(el('b', null, s.type), document.createTextNode(` — ${s.description || 'mission'} `), el('span', 'muted', `(${STATUS_FR[s.status] || s.status})`));
        if (s.result) li.append(el('div', 'muted small', s.result));
        if (live) {
          li.classList.add('link');
          li.onclick = () => openDetail({ type: 'agent', id: s.id });
        }
        ul.append(li);
      }
      if (!ul.children.length) ul.append(el('li', 'muted', 'Aucun sous-agent envoyé en mission.'));
      parts.push(ul);
    }

    parts.push(el('h3', null, 'Dernières actions'));
    const ol = el('ol', 'acts');
    for (const x of a.actions || []) {
      const li = el('li');
      li.append(el('time', null, fmtTime(x.t)), el('span', null, (x.who ? `[${x.who}] ` : '') + x.text));
      ol.append(li);
    }
    if (!ol.children.length) ol.append(el('li', 'muted', 'Rien encore.'));
    parts.push(ol);
    body.replaceChildren(...parts);
    panel.hidden = false;
  }
  function usageRows(a) {
    const u = a.usage || {};
    const t = a.tokens;
    const m = modelInfo(a);
    const rows = [];
    if (m) rows.push(['Modèle', m.full]);
    if (u.contextPct != null) {
      rows.push(['Contexte', `${pctTxt(u.contextPct)} utilisé${u.contextSize ? ` (fenêtre de ${fmtTok(u.contextSize)})` : ''}`, u.contextPct >= 85 ? 'warn' : null]);
    }
    if (t) {
      rows.push(['Entrée', `${fmtTok(t.input)} jetons`], ['Sortie', `${fmtTok(t.output)} jetons`],
        ['Cache créé', `${fmtTok(t.cacheCreation)} jetons`], ['Cache lu', `${fmtTok(t.cacheRead)} jetons`]);
    }
    if (u.costUsd != null) rows.push(['Coût', `${fmtUsd(u.costUsd)} (d'après Claude Code)`]);
    if (u.durationMs != null) rows.push(['Durée', fmtDur(u.durationMs)]);
    if (u.linesAdded != null || u.linesRemoved != null) rows.push(['Lignes', `+${u.linesAdded || 0} / −${u.linesRemoved || 0}`]);
    if (a.kind === 'session' && (a.subagentTotal || a.subTokens)) {
      rows.push(['Sous-agents', String(a.subagentTotal || 0)]);
      if (a.subTokens) rows.push(['Jetons sous-agents', `${fmtTok(a.subTokens.total)} (entrée ${fmtTok(a.subTokens.input)}, sortie ${fmtTok(a.subTokens.output)}, cache ${fmtTok(a.subTokens.cacheCreation + a.subTokens.cacheRead)})`]);
    }
    if (!rows.length && a.kind === 'session' && !a.demo) rows.push(['Usage', 'en attente de la status line et du transcript', 'muted']);
    return rows;
  }

  $('#detailClose').onclick = closeDetail;
  document.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape') closeDetail();
  });
  setInterval(() => state.detail && renderDetail(), 5000);

  // ------------------------------------------------------------ legend

  const LEGEND = [
    ['hobbit', 'Hobbits', 'les sessions'],
    ['dwarf', 'Nains', 'ceux qui codent'],
    ['wizard', 'Magiciens', 'ceux qui réfléchissent'],
    ['scout', 'Elfes éclaireurs', 'la recherche'],
    ['painter', 'Elfes artistes', 'les designers'],
    ['troll', 'Trolls', 'commandes et tests'],
    ['beacon', 'Balise allumée', 'attend ta réponse'],
    ['campfire', 'Feu de camp', 'au repos'],
    ['eagle', 'Aigle', 'message entre agents'],
  ];
  const legendCanvases = [];
  const legendList = $('#legendList');
  for (const [kind, title, desc] of LEGEND) {
    const li = el('li');
    const cv = el('canvas');
    legendCanvases.push([cv, kind]);
    const txt = el('span');
    txt.append(el('b', null, title), document.createTextNode(' = ' + desc));
    li.append(cv, txt);
    legendList.append(li);
  }
  function drawLegend() {
    const t = performance.now() / 1000;
    for (const [cv, kind] of legendCanvases) Sprites.drawIcon(cv, kind, t, 2);
  }
  drawLegend();
  setInterval(() => {
    if (prefs.legend) drawLegend();
  }, 200);
  function applyLegend() {
    $('#legend').classList.toggle('collapsed', !prefs.legend);
    $('#legendToggle').textContent = prefs.legend ? 'Légende ▾' : 'Légende ▸';
  }
  $('#legendToggle').onclick = () => {
    prefs.legend = !prefs.legend;
    savePrefs();
    applyLegend();
  };
  applyLegend();

  // ------------------------------------------------------------ toolbar

  function setDemo(on) {
    state.demo = on;
    const b = $('#btnDemo');
    b.textContent = on ? 'Mode démo : ON' : 'Mode démo : OFF';
    b.classList.toggle('on', on);
  }
  $('#btnDemo').onclick = async () => {
    const b = $('#btnDemo');
    b.disabled = true;
    try {
      const r = await fetch(state.demo ? 'demo/stop' : 'demo/start', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      const j = await r.json();
      setDemo(!!j.demo);
    } catch (e) {
      console.error(e);
    } finally {
      b.disabled = false;
    }
  };

  function applySound() {
    $('#btnSound').textContent = prefs.sound ? '🔔' : '🔕';
    $('#btnSound').title = prefs.sound ? 'Son des alertes : activé' : 'Son des alertes : coupé';
  }
  $('#btnSound').onclick = () => {
    prefs.sound = !prefs.sound;
    savePrefs();
    applySound();
    beep();
  };
  applySound();

  function applyMusic() {
    $('#btnMusic').textContent = prefs.music ? '🎵' : '🔇';
    $('#btnMusic').title = prefs.music ? "Musique d'ambiance : activée" : "Musique d'ambiance : coupée";
    if (prefs.music) Sound.music.start();
    else Sound.music.stop();
  }
  $('#btnMusic').onclick = () => {
    prefs.music = !prefs.music;
    savePrefs();
    applyMusic();
  };
  applyMusic();

  // ------------------------------------------------------------ notifications (📣)

  let flashTimer = null;
  /** Small status message at the bottom of the map. */
  function flash(text, kind) {
    const f = $('#flash');
    f.textContent = text;
    f.className = 'flash panel' + (kind ? ' ' + kind : '');
    f.hidden = false;
    clearTimeout(flashTimer);
    flashTimer = setTimeout(() => {
      f.hidden = true;
    }, 6000);
  }

  const NOTIF_STATE = {
    granted: ['on', 'Notifications : activées (clic = notification de test)'],
    authorized: ['on', 'Notifications macOS : activées (clic = notification de test)'],
    provisional: ['on', 'Notifications macOS : discrètes (clic = notification de test)'],
    ephemeral: ['on', 'Notifications macOS : activées (clic = notification de test)'],
    denied: ['', 'Notifications refusées : clic pour savoir comment les réactiver'],
    default: ['', 'Activer les notifications'],
    notDetermined: ['', 'Activer les notifications macOS'],
  };
  function setNotifButton(st) {
    const b = $('#btnNotif');
    const [cls, title] = NOTIF_STATE[st] || ['', 'Notifications'];
    b.classList.toggle('on', cls === 'on');
    b.title = title;
    b.dataset.state = st;
  }

  function sendNative(msg) {
    try {
      window.webkit.messageHandlers.lotr.postMessage(msg);
    } catch (e) {
      console.error('[lotr] pont natif', e);
    }
  }

  // Replies from the macOS app (evaluateJavaScript).
  window.LOTRNativeReply = function (msg) {
    if (!msg || msg.type !== 'notif') return;
    console.log('[lotr] état des notifications reçu du natif :', msg.state, msg.action || '');
    sendNative({ type: 'log', message: `page: état des notifications reçu = ${msg.state} (action ${msg.action || 'status'}${msg.tested ? ', test envoyé' : ''})` });
    setNotifButton(msg.state);
    if (msg.action !== 'request') return;
    if (msg.state === 'denied') {
      flash('🔕 Notifications refusées pour Terre du Milieu. Réglages Système > Notifications s\'ouvrent : active « Autoriser les notifications ».', 'bad');
    } else if (msg.tested) {
      flash('🔥 Notification de test envoyée. Rien ne s\'affiche ? Vérifie le mode Concentration et le style des alertes dans Réglages Système > Notifications.', 'good');
    } else if (msg.state === 'notDetermined') {
      flash('Autorisation non accordée : clique à nouveau sur 📣 pour la redemander.', 'bad');
    }
  };

  function browserTest() {
    try {
      const n = new Notification('🔥 Test — les feux d\'alarme fonctionnent', { body: 'Tu seras prévenu quand un agent attend ta réponse (si la page n\'est pas au premier plan).', tag: 'lotr-test' });
      n.onclick = () => window.focus();
      return true;
    } catch {
      return false;
    }
  }

  function applyNotif() {
    const b = $('#btnNotif');
    if (NATIVE) {
      sendNative({ type: 'notif', action: 'status' });
      return;
    }
    if (!('Notification' in window)) {
      b.hidden = true;
      return;
    }
    setNotifButton(Notification.permission);
  }
  $('#btnNotif').onclick = async () => {
    if (NATIVE) {
      sendNative({ type: 'notif', action: 'request' });
      return;
    }
    if (!('Notification' in window)) return;
    let st = Notification.permission;
    if (st === 'default') {
      try {
        st = await Notification.requestPermission();
      } catch {
        st = Notification.permission;
      }
    }
    setNotifButton(st);
    if (st === 'granted') {
      const ok = browserTest();
      flash(ok ? '📣 Notifications : granted — notification de test envoyée (les alertes arrivent quand la page n\'est pas au premier plan).'
        : '📣 Notifications : granted, mais le navigateur a refusé la notification de test.', ok ? 'good' : 'bad');
    } else if (st === 'denied') {
      flash('🔕 Notifications : denied. Pour les réactiver : clique sur le cadenas (ou l\'icône du site) à gauche de l\'adresse > Notifications > Autoriser, puis recharge la page.', 'bad');
    } else {
      flash('📣 Notifications : default — la demande a été fermée sans réponse. Clique à nouveau pour la refaire.', '');
    }
  };
  applyNotif();

  function applyNight() {
    scene.nightEnabled = prefs.night;
    $('#btnNight').classList.toggle('on', prefs.night);
    $('#btnNight').title = prefs.night ? 'Cycle jour/nuit (heure locale) : activé' : 'Cycle jour/nuit : désactivé';
  }
  $('#btnNight').onclick = () => {
    prefs.night = !prefs.night;
    savePrefs();
    applyNight();
  };
  applyNight();

  function applySide() {
    document.body.classList.toggle('side-collapsed', !prefs.side);
    $('#btnSide').classList.toggle('on', prefs.side);
  }
  $('#btnSide').onclick = () => {
    prefs.side = !prefs.side;
    savePrefs();
    applySide();
  };
  if (window.matchMedia('(max-width: 820px)').matches) prefs.side = false;
  applySide();

  renderFeeds();
  renderSummary();
  setConn(false);
  connect();
})();
