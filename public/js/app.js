/* App: SSE connection, state, and all the HTML panels around the map. */
(function () {
  'use strict';

  const { Scene, STATUS, roleAvatar } = window.LOTRScene;
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
  };

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
  function isActive(a) {
    return a.status !== 'done';
  }

  // ------------------------------------------------------------ scene

  const tooltip = $('#tooltip');
  const scene = new Scene($('#map'), {
    onPick(hit) {
      if (!hit) return closeDetail();
      if (hit.type === 'agent') openDetail({ type: 'agent', id: hit.id });
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
      if (hit.type === 'agent') {
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
    on('demo', (d) => setDemo(d.on));
    es.onopen = () => setConn(true);
    es.onerror = () => setConn(false);
  }

  function applySnapshot(snap) {
    state.agents.clear();
    for (const a of snap.agents || []) state.agents.set(a.id, a);
    state.chronicle = (snap.chronicle || []).slice(-MAX_FEED);
    state.council = (snap.council || []).slice(-MAX_FEED);
    setDemo(!!snap.demo);
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
    box.replaceChildren(...chips.map(([icon, n, txt]) => {
      const c = el('span', 'chip' + (icon === '🔥' && n > 0 ? ' hot' : ''));
      c.append(el('span', 'chip-icon', icon), el('b', null, String(n)), el('span', 'chip-txt', ' ' + txt));
      return c;
    }));
  }

  // ------------------------------------------------------------ alerts

  const Sound = window.LOTRAudio;
  function beep() {
    if (prefs.sound) Sound.beep();
  }

  function notify(a) {
    beep();
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

  function applyNotif() {
    const b = $('#btnNotif');
    if (!('Notification' in window)) {
      b.hidden = true;
      return;
    }
    b.classList.toggle('on', Notification.permission === 'granted');
    b.title = Notification.permission === 'granted' ? 'Notifications du navigateur : activées' : 'Activer les notifications du navigateur';
  }
  $('#btnNotif').onclick = async () => {
    if (!('Notification' in window)) return;
    try {
      await Notification.requestPermission();
    } catch {
      /* ignore */
    }
    applyNotif();
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
