/* App: SSE connection, state, and all the HTML panels around the map. */
(function () {
  'use strict';

  // Every UI string goes through t() (public/js/i18n.js, dictionaries in public/i18n/<lang>.js).
  const I18N = window.LOTRI18N;
  const t = (key, params) => I18N.t(key, params);
  /** Text of a translatable server message ({ key, params }), else the French fallback text. */
  const R = (msg, fallback) => (msg && msg.key ? I18N.render(msg) : fallback == null ? '' : fallback);
  // Invented languages (elf / dwarf / ent): the French text is shown as a gloss (tooltip or small line).
  /** Tooltip text: the translation, plus its French gloss in an invented language. */
  const tt = (key, params) => I18N.withGloss(t(key, params), key, params);

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

  /** Small French line under an invented text (null when not needed). */
  function glossEl(text, tag) {
    return text ? el(tag || 'div', 'gloss', text) : null;
  }
  const gl = (key, params) => I18N.gloss(key, params);
  const glMsg = (msg) => I18N.glossMsg(msg);
  /** Appends a gloss line (if any) to a node and returns the node. */
  function withGlossLine(node, text, tag) {
    const g = glossEl(text, tag);
    if (g) node.append(g);
    return node;
  }

  /** Element whose text is the key's translation (refreshed by applyStatic on a language change). */
  function tel(tag, cls, key, isTitle) {
    const n = el(tag, cls);
    n.dataset.i18n = key;
    if (isTitle) n.dataset.title = '';
    return n;
  }
  /** Template with {name} slots -> text nodes and the given DOM nodes. */
  function fill(template, nodes) {
    const out = [];
    let last = 0;
    String(template).replace(/\{(\w+)\}/g, (m, name, at) => {
      if (at > last) out.push(document.createTextNode(template.slice(last, at)));
      out.push(nodes[name] || document.createTextNode(m));
      last = at + m.length;
      return m;
    });
    if (last < template.length) out.push(document.createTextNode(template.slice(last)));
    return out;
  }
  /** A heading in the current language: elf ornaments, dwarf runes under it. */
  function heading(tag, text) {
    const h = el(tag);
    setTitleText(h, text);
    return h;
  }
  function setTitleText(node, text) {
    const lang = I18N.getLang();
    if (lang === 'elf') {
      // Elf: original ornaments around the title (a symbol font, so they stay crisp and visible).
      const orn = (c) => {
        const o = el('span', 'orn', c);
        o.setAttribute('aria-hidden', 'true');
        return o;
      };
      node.replaceChildren(orn('✧ '), document.createTextNode(text), orn(' ✧'));
      return;
    }
    node.textContent = text;
    if (lang === 'dwarf') {
      const r = el('span', 'runes', I18N.runes(text));
      r.setAttribute('aria-hidden', 'true');
      node.append(r);
    }
  }
  /** Static texts: [data-i18n] (text), [data-i18n-title], [data-i18n-aria]; data-title = title styling. */
  function applyStatic(root) {
    root = root || document;
    const all = (sel) => (root.matches && root.matches(sel) ? [root] : []).concat([...root.querySelectorAll(sel)]);
    for (const n of all('[data-i18n]')) {
      const key = n.dataset.i18n;
      const text = t(key);
      if ('title' in n.dataset) setTitleText(n, text);
      else n.textContent = text;
      // data-i18n-gloss: French on a small line inside; otherwise in the tooltip.
      const g = gl(key);
      if ('i18nGloss' in n.dataset) withGlossLine(n, g, 'span');
      else if (!('i18nTitle' in n.dataset)) {
        if (g) n.title = g;
        else if (n.title && n.dataset.glossTitle) n.removeAttribute('title');
        n.dataset.glossTitle = g ? '1' : '';
      }
    }
    for (const n of all('[data-i18n-title]')) n.title = tt(n.dataset.i18nTitle);
    for (const n of all('[data-i18n-aria]')) n.setAttribute('aria-label', t(n.dataset.i18nAria));
  }

  const MAX_FEED = 200;
  const STATUSES = ['coding', 'thinking', 'running', 'designing', 'talking', 'waiting', 'idle', 'done'];
  const roleLabel = (avatar) => t('role.label.' + avatar);
  const statusText = (st) => (STATUSES.includes(st) ? t('status.' + st) : st);
  const councilKind = (k) => (['spawn', 'return', 'message'].includes(k) ? t('council.kind.' + k) : k);
  const terrName = (key) => (TERR[key] ? t('terr.' + key) : key || '');

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
    snapWaiting: new Set(),
    lastLogId: 0,
    reminders: new Map(), // waiting key -> { n, next }
    worked: new Map(), // sessionId -> did something since the last prompt
    returned: new Set(), // subagent ids already greeted by the fanfare
    usage: { real: null, demo: null },
  };
  // Inside the macOS app (WKUserScript): native notifications replace the Web ones.
  const NATIVE = !!(window.LOTRNative && window.LOTRNative.app && window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.lotr);

  // sfx: effects (beep + alerts + ambient), on by default; music off by default; volumes 0..1.
  let prefsMigrated = false;
  const prefs = (() => {
    const d = { mute: false, sfx: true, music: false, night: true, legend: true, side: true, volume: 0.8, musicVolume: 0.8, sfxVolume: 0.8, lang: null };
    let saved = {};
    try {
      saved = JSON.parse(localStorage.getItem('lotr-prefs') || '{}') || {};
    } catch {
      saved = {};
    }
    if (typeof saved !== 'object' || Array.isArray(saved)) saved = {};
    // Before: { sound: bool } for the alert beep only.
    if ('sound' in saved) {
      if (typeof saved.sfx !== 'boolean' && typeof saved.sound === 'boolean') saved.sfx = saved.sound;
      delete saved.sound;
      prefsMigrated = true;
    }
    const p = Object.assign(d, saved);
    for (const k of ['volume', 'musicVolume', 'sfxVolume']) {
      const v = Number(p[k]);
      p[k] = Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0.8;
    }
    p.sfx = p.sfx !== false;
    p.mute = p.mute === true;
    if (!I18N.isLang(p.lang)) p.lang = null; // null: from the app (native), else navigator.language
    return p;
  })();
  function savePrefs() {
    try {
      localStorage.setItem('lotr-prefs', JSON.stringify(prefs));
    } catch {
      /* ignore */
    }
  }

  // ------------------------------------------------------------ helpers

  const fmtTime = (ts) => I18N.time(ts);
  const pad2 = (n) => String(n).padStart(2, '0');
  function since(ts) {
    const sec = Math.max(0, Math.round((Date.now() - ts) / 1000));
    if (sec < 60) return t('dur.s', { n: sec });
    const m = Math.floor(sec / 60);
    if (m < 60) return t('dur.m', { n: m });
    return t('dur.hmin', { h: Math.floor(m / 60), m: m % 60 });
  }
  function label(a) {
    return a.kind === 'subagent' ? `${a.project} · ${a.subagentType}` : a.project;
  }

  // ------------------------------------------------------------ « aller à cette session »

  // The app only acts on the agent id: it reads the origin from its own state, never from the page.
  const NATIVE_FOCUS = () => NATIVE && window.LOTRNative.focusSession === true;
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  /** The session an agent belongs to (a subagent goes to its parent session). */
  function sessionOf(a) {
    if (!a || a.kind !== 'subagent') return a;
    return state.agents.get(a.sessionId) || a;
  }

  function originLabel(o) {
    if (!o) return '';
    if (o.entrypoint === 'claude-desktop') return t('origin.desktop');
    if (o.termProgram === 'Apple_Terminal') return t('origin.terminal');
    if (o.termProgram === 'iTerm.app') return t('origin.iterm');
    if (o.termProgram === 'vscode') return /todesktop|cursor/i.test(o.bundleId || '') ? t('origin.cursor') : t('origin.vscode');
    if (o.termProgram) return t('origin.other', { name: o.termProgram });
    return o.entrypoint ? t('origin.other', { name: o.entrypoint }) : '';
  }

  function goToSession(agent) {
    const s = sessionOf(agent);
    if (!s) return;
    if (NATIVE_FOCUS()) {
      sendNative({ type: 'focusSession', agentId: s.id });
      flashT('', 'go.going', { name: label(s) });
      return;
    }
    showSessionHint(s);
  }

  function shQuote(v) {
    return `'${String(v).replace(/'/g, `'\\''`)}'`;
  }

  let hintBox = null;
  function showSessionHint(s) {
    if (!hintBox) {
      hintBox = el('div', 'session-hint panel');
      hintBox.setAttribute('role', 'dialog');
      hintBox.setAttribute('aria-label', t('go.hintTitle'));
      document.body.append(hintBox);
      document.addEventListener('keydown', (ev) => {
        if (ev.key === 'Escape') hintBox.hidden = true;
      });
    }
    const head = el('div', 'sp-head');
    const x = el('button', 'btn small ghost', '×');
    x.type = 'button';
    x.title = tt('sound.close');
    x.onclick = () => (hintBox.hidden = true);
    head.append(el('b', null, t('go.hintTitle')), x);
    const p = (key, cls) => withGlossLine(el('p', cls || null, t(key)), gl(key));
    const parts = [head, p('go.hintBrowser')];
    const o = s.origin || {};
    if (o.entrypoint === 'claude-desktop') {
      parts.push(p('go.hintDesktop'));
    } else if (UUID_RE.test(s.id)) {
      const cmd = (s.cwd ? `cd ${shQuote(s.cwd)} && ` : '') + `claude --resume ${s.id}`;
      const code = el('code', 'hint-cmd', cmd);
      const copy = el('button', 'btn small', t('go.copy'));
      copy.type = 'button';
      copy.onclick = async () => {
        try {
          await navigator.clipboard.writeText(cmd);
          copy.textContent = t('go.copied');
        } catch {
          copy.textContent = t('go.copyFailed');
        }
      };
      parts.push(p('go.hintResume'), code, copy);
    } else {
      parts.push(p('go.hintNoId', 'muted'));
    }
    parts.push(p('go.hintApp', 'sp-hint'));
    hintBox.replaceChildren(...parts);
    hintBox.hidden = false;
  }
  const dec = (n, d) => I18N.num(n, d);
  /** 950 · 1,2 k · 3,4 M · 1,1 G (decimal separator and unit spacing of the language) */
  function fmtTok(n) {
    n = Number(n) || 0;
    if (n < 1000) return I18N.num(Math.round(n), 0);
    if (n < 1e6) return t('fmt.k', { n: dec(n / 1e3, n < 1e4 ? 1 : 0) });
    if (n < 1e9) return t('fmt.M', { n: dec(n / 1e6, n < 1e7 ? 1 : 0) });
    return t('fmt.G', { n: dec(n / 1e9, 1) });
  }
  const fmtUsd = (v) => t('fmt.usd', { n: dec(Number(v) || 0, 2) });
  function fmtDur(ms) {
    const sec = Math.max(0, Math.round((Number(ms) || 0) / 1000));
    if (sec < 60) return t('dur.s', { n: sec });
    const m = Math.floor(sec / 60);
    if (m < 60) return t('dur.m', { n: m });
    return t('dur.hm', { h: Math.floor(m / 60), mm: pad2(m % 60) });
  }
  /** Countdown to an epoch (seconds): "1 h 26", "12 min", "3 j 4 h". */
  function fmtLeft(epochS) {
    const sec = Math.round(epochS - Date.now() / 1000);
    if (sec <= 0) return null;
    if (sec < 60) return t('dur.s', { n: sec });
    const m = Math.floor(sec / 60);
    if (m < 60) return t('dur.m', { n: m });
    const h = Math.floor(m / 60);
    if (h < 24) return t('dur.hm', { h, mm: pad2(m % 60) });
    return t('dur.dh', { d: Math.floor(h / 24), h: h % 24 });
  }
  const pctTxt = (p) => t('fmt.pct', { n: Math.round(p) });
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
          text = t('tip.lantern', { project: a.project, pct: pctTxt(p) });
        } else {
          const m = modelInfo(a);
          text = t('tip.model', { project: a.project, model: m ? m.full : t('usage.unknownModel') });
        }
      } else if (hit.type === 'agent') {
        const a = state.agents.get(hit.id);
        if (!a) return;
        const act = R(a.lastActionI, a.lastAction);
        text = `${label(a)} — ${roleLabel(roleAvatar(a.role))}\n${statusText(a.status)}${act ? ' · ' + act : ''}`;
      } else {
        const here = [...state.agents.values()].filter((a) => a.kind === 'session' && isActive(a) && a.territory === hit.key);
        text = `${terrName(hit.key)}\n${here.length ? here.map((a) => a.project).join(', ') : t('tip.emptyLand')}`;
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
  if (prefsMigrated) savePrefs();

  // ------------------------------------------------------------ SSE

  const conn = $('#conn');
  let connOk = false;
  function setConn(ok) {
    connOk = ok;
    conn.textContent = t(ok ? 'conn.online' : 'conn.offline');
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
    on('log', (entry) => {
      addLog(entry);
      soundFor(entry);
    });
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
    // What is already there when the page (re)connects never makes a sound.
    state.snapWaiting = new Set((snap.agents || []).filter((a) => a.status === 'waiting').map(waitKey));
    // Reset (not max): a restarted server numbers its log entries from 1 again.
    state.lastLogId = 0;
    for (const e of (snap.chronicle || []).concat(snap.council || [])) state.lastLogId = Math.max(state.lastLogId, Number(e.id) || 0);
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
      ['🏰', act.filter((a) => a.kind === 'session').length, 'chip.companies'],
      ['👥', act.length, 'chip.agents'],
      ['⚒', count('coding'), 'chip.coding'],
      ['🧙', count('thinking'), 'chip.thinking'],
      ['🪨', count('running'), 'chip.running'],
      ['🎨', count('designing'), 'chip.designing'],
      ['🔥', count('waiting'), 'chip.waiting'],
    ];
    const box = $('#summary');
    const nodes = chips.map(([icon, n, key]) => {
      const c = el('span', 'chip' + (icon === '🔥' && n > 0 ? ' hot' : ''));
      c.append(el('span', 'chip-icon', icon), el('b', null, I18N.num(n)), el('span', 'chip-txt', ' ' + t(key, { count: n })));
      const g = gl(key, { count: n });
      if (g) c.title = g;
      return c;
    });
    // Today's usage, all sessions (since local midnight).
    const u = currentToday();
    if (u) {
      const today = u.today;
      const demo = u.demo ? t('chip.demo') : '';
      if (today.tokens) {
        const tk = today.tokens;
        const c = el('span', 'chip usage');
        c.append(el('span', 'chip-icon', '🪙'), el('b', null, fmtTok(tk.total)), el('span', 'chip-txt', ' ' + t('chip.tokens') + demo));
        c.title = tt('chip.tokensTip', { demo, input: fmtTok(tk.input), output: fmtTok(tk.output), cc: fmtTok(tk.cacheCreation), cr: fmtTok(tk.cacheRead) });
        nodes.push(c);
      }
      if (today.costUsd != null) {
        const c = el('span', 'chip usage');
        c.append(el('span', 'chip-icon', '💰'), el('b', null, fmtUsd(today.costUsd)), el('span', 'chip-txt', ' ' + t('chip.today') + demo));
        c.title = tt('chip.costTip', { count: today.costSessions, demo });
        nodes.push(c);
      }
    }
    box.replaceChildren(...nodes);
  }

  // ------------------------------------------------------------ reserves (5 h / 7 day limits)

  const GAUGES = {
    five: { node: $('#gFive') },
    seven: { node: $('#gSeven') },
  };
  function renderReserves() {
    const box = $('#reserves');
    const u = currentLimits();
    box.classList.toggle('demo', !!(u && u.demo));
    box.querySelector('.reserves-title').dataset.demo = t('header.demoTag');
    const wait = $('#reservesWait');
    if (!u) {
      box.setAttribute('data-empty', '');
      // No 5 h / 7 day limits (no status line, e.g. sessions of the desktop app): today's tokens instead.
      const td = currentToday();
      const tk = td && td.today.tokens;
      const cost = td && td.today.costUsd;
      if (td && (tk || cost != null)) {
        const demo = td.demo ? t('chip.demo') : '';
        const key = tk && cost != null ? 'header.todayTokensCost' : tk ? 'header.todayTokens' : 'header.todayCost';
        const params = { n: tk ? fmtTok(tk.total) : '', usd: cost != null ? fmtUsd(cost) : '' };
        wait.textContent = t(key, params) + demo;
        box.title = tt('gauge.noLimitsTip');
        const g = gl(key, params);
        if (g) box.title += '\n— ' + g;
      } else {
        wait.textContent = t('header.reservesWait');
        box.title = tt('gauge.empty');
      }
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
      g.node.querySelector('.g-val').textContent = expired ? t('gauge.refilled') : `${pctTxt(pct)}${left ? ' · ' + left : ''}`;
      const at = w.resetsAt ? I18N.date(w.resetsAt * 1000, { weekday: k === 'seven' ? 'short' : undefined, hour: '2-digit', minute: '2-digit' }) : null;
      g.node.title = `${t('gauge.' + k)} : ${t('gauge.' + k + '.what')}.\n`
        + (expired ? t('gauge.tipExpired')
          : left ? t('gauge.tipUsedReset', { pct: pctTxt(pct), left, at }) : t('gauge.tipUsed', { pct: pctTxt(pct) }))
        + '\n' + t(u.demo ? 'gauge.tipColorsDemo' : 'gauge.tipColors');
      if (I18N.isFantasy(I18N.getLang())) {
        const fr = (key, params) => I18N.tl('fr', key, params);
        g.node.title += `\n— ${fr('gauge.' + k)} : ${fr('gauge.' + k + '.what')}.`;
      }
    }
    const five = u.five && u.five.pct != null && !(u.five.resetsAt && !fmtLeft(u.five.resetsAt)) ? u.five.pct : 0;
    scene.usage = { fivePct: five };
  }
  setInterval(renderReserves, 1000);

  // ------------------------------------------------------------ alerts

  const Sound = window.LOTRAudio;
  function beep() {
    if (prefs.sfx) Sound.beep();
  }

  /** The waiting message of an agent, in the current language. */
  const waitText = (a) => (a.waiting ? R(a.waiting.i, a.waiting.message) : '');
  const waitKey = (a) => a.id + ':' + ((a.waiting && a.waiting.since) || 0);
  const BEACON_EVERY_MS = 45000;
  const BEACON_MAX = 5;

  function notify(a, silent) {
    if (!silent) {
      Sound.sfx.play('beacon');
      state.reminders.set(waitKey(a), { n: 1, next: Date.now() + BEACON_EVERY_MS });
    }
    if (NATIVE) return; // the macOS app already sends a native notification for this wait
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    if (!document.hidden && document.hasFocus()) return;
    try {
      const n = new Notification(t('notif.waitTitle', { who: label(a) }), { body: waitText(a), tag: a.id });
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
    const now = Date.now();
    for (const a of waiting) {
      const key = waitKey(a);
      keys.add(key);
      if (!state.knownWaiting.has(key)) notify(a, state.snapWaiting.has(key));
      // The beacon calls again every ~45 s while the wait lasts (5 calls at most, none once dismissed).
      const r = state.reminders.get(key);
      if (r && r.n < BEACON_MAX && now >= r.next && !state.dismissed.has(key)) {
        r.n++;
        r.next = now + BEACON_EVERY_MS;
        Sound.sfx.play('beacon');
      }
    }
    state.knownWaiting = keys;
    for (const k of [...state.reminders.keys()]) if (!keys.has(k)) state.reminders.delete(k);
    Sound.music.setTension(waiting.length > 0);
    for (const k of [...state.dismissed]) if (!keys.has(k)) state.dismissed.delete(k);

    // Reconcile toasts in place (keeps buttons clickable while "depuis" ticks).
    const box = $('#alerts');
    const visible = waiting.filter((a) => !state.dismissed.has(a.id + ':' + ((a.waiting && a.waiting.since) || 0)));
    const want = new Set();
    for (const a of visible) {
      const key = a.id + ':' + ((a.waiting && a.waiting.since) || 0);
      want.add(key);
      let toast = toastNodes.get(key);
      if (!toast) {
        toast = el('div', 'toast');
        const beacon = el('canvas', 'toast-icon');
        Sprites.drawIcon(beacon, 'beacon', 0.1, 1.5);
        const txt = el('div', 'toast-txt');
        txt.append(el('div', 'toast-title'), el('div', 'toast-msg'), el('div', 'gloss toast-gloss'), el('div', 'toast-meta'));
        const see = el('button', 'btn small toast-see');
        see.onclick = () => openDetail({ type: 'agent', id: a.id });
        const go = el('button', 'btn small toast-go');
        go.onclick = () => goToSession(state.agents.get(a.id) || a);
        const x = el('button', 'btn small ghost toast-x', '×');
        x.onclick = () => {
          state.dismissed.add(key);
          renderAlerts();
        };
        if (a.demo) toast.append(beacon, txt, see, x);
        else toast.append(beacon, txt, see, go, x);
        toastNodes.set(key, toast);
        box.append(toast);
      }
      // Texts refreshed each time (language change, "depuis" ticking).
      const title = toast.querySelector('.toast-title');
      title.replaceChildren(...fill(t('alert.waitsTitle', { who: '{who}' }), { who: el('b', null, label(a)) }));
      toast.querySelector('.toast-msg').textContent = waitText(a) || t('alert.fires');
      // Invented language: the vital part in French, on a small line.
      const gTitle = gl('alert.waitsTitle', { who: label(a) });
      const gMsg = a.waiting && a.waiting.i ? glMsg(a.waiting.i) : waitText(a) ? null : gl('alert.fires');
      const gNode = toast.querySelector('.toast-gloss');
      gNode.textContent = gTitle ? gTitle + (gMsg ? ' : ' + gMsg : '') : '';
      gNode.hidden = !gTitle;
      toast.querySelector('.toast-see').title = gl('alert.see') || '';
      toast.querySelector('.toast-see').textContent = t('alert.see');
      const go = toast.querySelector('.toast-go');
      if (go) {
        go.textContent = t('go.short');
        go.title = tt('go.title');
      }
      toast.querySelector('.toast-x').title = tt('alert.hide');
      toast.querySelector('.toast-meta').textContent = t('alert.meta', { terr: terrName(a.territory), since: since((a.waiting && a.waiting.since) || Date.now()) });
    }
    for (const [k, node] of toastNodes) {
      if (!want.has(k)) {
        node.remove();
        toastNodes.delete(k);
      }
    }
    let count = box.querySelector('.alerts-count');
    if (visible.length > 1) {
      if (!count) {
        count = el('div', 'alerts-count');
        box.prepend(count);
      }
      count.textContent = t('alert.count', { count: visible.length });
    } else if (count) count.remove();
    document.title = waiting.length ? t('app.titleWaiting', { count: waiting.length }) : t('app.title');
  }
  setInterval(() => {
    if ([...state.agents.values()].some((a) => a.status === 'waiting')) renderAlerts();
  }, 1000);

  // ------------------------------------------------------------ sound effects for live events

  const EDIT_TOOLS = new Set(['Edit', 'MultiEdit', 'Write', 'NotebookEdit']);
  /** Live log entries only (the snapshot and the server's replayed events never reach here). */
  function soundFor(e) {
    if (!e || (Number(e.id) || 0) <= state.lastLogId) return;
    state.lastLogId = Number(e.id) || state.lastLogId;
    const sid = e.sessionId;
    if (e.kind === 'return') {
      // PostToolUse(Agent) and SubagentStop both report the return: one fanfare per subagent.
      if (e.agentId && !state.returned.has(e.agentId)) {
        state.returned.add(e.agentId);
        if (state.returned.size > 500) state.returned.clear();
        Sound.sfx.play('fanfare');
      }
      if (sid) state.worked.set(sid, true);
      return;
    }
    if (e.channel !== 'chronicle') return;
    switch (e.kind) {
      case 'start':
        Sound.sfx.play('inn');
        break;
      case 'prompt':
        if (sid) state.worked.set(sid, false);
        break;
      case 'spawn':
        if (sid) state.worked.set(sid, true);
        Sound.sfx.play('horn');
        break;
      case 'message':
        if (sid) state.worked.set(sid, true);
        Sound.sfx.play('eagle');
        break;
      case 'tool':
        if (sid) state.worked.set(sid, true);
        if (EDIT_TOOLS.has(e.tool) || (!e.tool && e.icon === '⚒')) Sound.sfx.play('anvil');
        break;
      case 'idle': // Stop: fanfare only when the turn actually did something
        if (sid && state.worked.get(sid)) {
          state.worked.set(sid, false);
          Sound.sfx.play('fanfare');
        }
        break;
      case 'usage':
        if (e.reset) Sound.sfx.play('sunrise');
        else if (Number(e.level) >= 80) Sound.sfx.play('drum');
        break;
      default:
        break;
    }
  }

  Sound.ambient.setProvider(() => {
    const act = [...state.agents.values()].filter(isActive);
    return {
      night: scene.forceNight || (prefs.night && window.LOTRMap.nightAmount(new Date()) > 0.19),
      coding: act.some((a) => a.status === 'coding'),
      calm: !act.some((a) => a.status !== 'idle'),
    };
  });

  // ------------------------------------------------------------ feeds

  function matches(entry) {
    return !state.filter || entry.sessionId === state.filter;
  }

  function chronicleItem(e) {
    const li = el('li', 'item kind-' + e.kind);
    li.append(el('time', null, fmtTime(e.t)), el('span', 'icon', e.icon || '•'), withGlossLine(el('span', 'txt', R(e, e.text)), glMsg(e)));
    if (e.agentId) li.onclick = () => state.agents.has(e.agentId) && openDetail({ type: 'agent', id: e.agentId });
    return li;
  }

  function councilItem(e) {
    const li = el('li', 'letter kind-' + e.kind);
    const head = el('div', 'head');
    head.append(el('span', 'icon', e.icon || '✉'), el('span', 'kind', councilKind(e.kind)), el('time', null, fmtTime(e.t)));
    const route = el('div', 'route');
    route.append(el('b', null, e.from || '?'), document.createTextNode(' → '), el('b', null, R(e.toI, e.to) || '?'));
    li.append(head, route, withGlossLine(el('div', 'title', R(e, e.text)), glMsg(e)));
    const body = R(e.bodyI, e.body);
    if (body) li.append(withGlossLine(el('div', 'body', body), glMsg(e.bodyI)));
    if (e.agentId) li.onclick = () => state.agents.has(e.agentId) && openDetail({ type: 'agent', id: e.agentId });
    return li;
  }

  function renderFeeds() {
    const ch = $('#chronicle');
    const co = $('#council');
    ch.replaceChildren(...state.chronicle.filter(matches).slice(-MAX_FEED).reverse().map(chronicleItem));
    co.replaceChildren(...state.council.filter(matches).slice(-MAX_FEED).reverse().map(councilItem));
    if (!ch.children.length) ch.append(el('li', 'feed-empty', t('feed.emptyChronicle')));
    if (!co.children.length) co.append(el('li', 'feed-empty', t('feed.emptyCouncil')));
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
    const sig = sessions.map((s) => s.id + s.project + s.status).join('|') + '#' + state.filter + '#' + I18N.getLang();
    if (sig === filterSig) return;
    filterSig = sig;
    const sel = $('#filter');
    const opts = [el('option', null, t('filter.all'))];
    opts[0].value = '';
    for (const s of sessions) {
      const o = el('option', null, s.project + (s.status === 'done' ? ' ' + t('filter.gone') : ''));
      o.value = s.id;
      opts.push(o);
    }
    if (state.filter && !sessions.some((s) => s.id === state.filter)) {
      const o = el('option', null, t('filter.vanished'));
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
      const dt = el('dt', null, k);
      box.append(dt);
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
      const g = TERR[d.key] ? gl('terr.' + d.key) : null;
      head.replaceChildren(el('h2', null, terrName(d.key)), withGlossLine(el('div', 'sub', t('detail.emptyLand')), g ? g + ' · ' + gl('detail.emptyLand') : null));
      Sprites.drawIcon(icon, 'campfire', 0, 2);
      body.replaceChildren(withGlossLine(el('p', 'muted', t('detail.emptyLandText')), gl('detail.emptyLandText')));
      panel.hidden = false;
      return;
    }
    const a = state.agents.get(d.id);
    if (!a) {
      head.replaceChildren(el('h2', null, t('detail.gone')), el('div', 'sub', t('detail.goneText')));
      body.replaceChildren();
      panel.hidden = false;
      return;
    }
    const avatar = roleAvatar(a.role);
    Sprites.drawIcon(icon, avatar === 'hobbit' ? 'hobbit' : avatar, performance.now() / 1000, 2);
    const sub = `${roleLabel(avatar)}${a.subagentType ? ' · ' + a.subagentType : ''}${TERR[a.territory] ? ' · ' + terrName(a.territory) : ''}`;
    head.replaceChildren(el('h2', null, a.project), el('div', 'sub', sub));

    const st = STATUS[a.status] || STATUS.idle;
    const badge = el('span', 'badge', statusText(a.status));
    badge.style.background = st.color;

    const counters = Object.entries(a.counters || {}).sort((p, q) => q[1] - p[1]).slice(0, 8);
    const ctr = el('div', 'counters');
    for (const [k, n] of counters) ctr.append(el('span', 'ctr', `${k.replace(/^mcp__/, '🔮')} ×${n}`));

    const sess = sessionOf(a);
    const prompt = R(a.lastPromptI, a.lastPrompt);
    const lastAction = R(a.lastActionI, a.lastAction);
    const rows = [
      [t('detail.status'), badge],
      [t('detail.origin'), originLabel(sess && sess.origin)],
      a.waiting ? [t('detail.waiting'), withGlossLine(el('span', null, t('detail.waitingVal', { msg: waitText(a), since: since(a.waiting.since) })), a.waiting.i ? glMsg(a.waiting.i) : null), 'warn'] : null,
      [t('detail.cwd'), a.cwd, 'mono'],
      a.kind === 'session' ? [t('detail.lastPrompt'), prompt ? t('detail.quote', { text: prompt }) : '—'] : null,
      a.kind === 'subagent' ? [t('detail.mission'), R(a.descriptionI, a.description)] : null,
      a.kind === 'subagent' ? [t('detail.orders'), R(a.promptI, a.prompt)] : null,
      a.kind === 'subagent' && a.result ? [t('detail.report'), R(a.resultI, a.result)] : null,
      [t('detail.lastAction'), lastAction ? t('detail.lastActionVal', { action: lastAction, since: since(a.lastActionAt) }) : '—'],
      [t('detail.tools'), counters.length ? ctr : t('detail.noTools')],
      [t('detail.arrival'), fmtTime(a.startedAt)],
    ].filter(Boolean);
    const go = el('button', 'btn small go-session', t('go.button'));
    go.type = 'button';
    go.title = tt('go.title');
    go.onclick = () => goToSession(state.agents.get(a.id) || a);
    const parts = a.demo ? [dl(rows)] : [go, dl(rows)];
    const usage = usageRows(a);
    if (usage.length) parts.push(heading('h3', t('detail.usage')), dl(usage));

    if (a.kind === 'subagent') {
      const parent = state.agents.get(a.parentId) || state.agents.get(a.sessionId);
      if (parent) {
        const b = el('button', 'btn small', `← ${label(parent)}`);
        b.onclick = () => openDetail({ type: 'agent', id: parent.id });
        parts.push(b);
      }
    }

    if (a.kind === 'session') {
      parts.push(heading('h3', t('detail.subagents', { count: (a.subagents || []).length })));
      const ul = el('ul', 'subs');
      for (const s of a.subagents || []) {
        const li = el('li', 'sub-' + s.status);
        const live = state.agents.get(s.id);
        li.append(el('b', null, s.type), document.createTextNode(` — ${R(s.descriptionI, s.description) || t('word.mission')} `), el('span', 'muted', `(${statusText(s.status)})`));
        if (s.result) li.append(el('div', 'muted small', R(s.resultI, s.result)));
        if (live) {
          li.classList.add('link');
          li.onclick = () => openDetail({ type: 'agent', id: s.id });
        }
        ul.append(li);
      }
      if (!ul.children.length) ul.append(el('li', 'muted', t('detail.noSubagents')));
      parts.push(ul);
    }

    parts.push(heading('h3', t('detail.actions')));
    const ol = el('ol', 'acts');
    for (const x of a.actions || []) {
      const li = el('li');
      li.append(el('time', null, fmtTime(x.t)), el('span', null, (x.who ? `[${x.who}] ` : '') + R(x, x.text)));
      ol.append(li);
    }
    if (!ol.children.length) ol.append(el('li', 'muted', t('detail.noActions')));
    parts.push(ol);
    body.replaceChildren(...parts);
    panel.hidden = false;
  }
  function usageRows(a) {
    const u = a.usage || {};
    const tk = a.tokens;
    const m = modelInfo(a);
    const rows = [];
    if (m) rows.push([t('usage.model'), m.full]);
    if (u.contextPct != null) {
      rows.push([t('usage.context'), u.contextSize ? t('usage.contextWin', { pct: pctTxt(u.contextPct), size: fmtTok(u.contextSize) }) : t('usage.contextVal', { pct: pctTxt(u.contextPct) }), u.contextPct >= 85 ? 'warn' : null]);
    }
    if (tk) {
      const n = (v) => t('usage.tokens', { n: fmtTok(v) });
      rows.push([t('usage.input'), n(tk.input)], [t('usage.output'), n(tk.output)],
        [t('usage.cacheCreated'), n(tk.cacheCreation)], [t('usage.cacheRead'), n(tk.cacheRead)]);
    }
    if (u.costUsd != null) rows.push([t('usage.cost'), t('usage.costVal', { usd: fmtUsd(u.costUsd) })]);
    if (u.durationMs != null) rows.push([t('usage.duration'), fmtDur(u.durationMs)]);
    if (u.linesAdded != null || u.linesRemoved != null) rows.push([t('usage.lines'), `+${u.linesAdded || 0} / −${u.linesRemoved || 0}`]);
    if (a.kind === 'session' && (a.subagentTotal || a.subTokens)) {
      rows.push([t('usage.subagents'), I18N.num(a.subagentTotal || 0)]);
      const st = a.subTokens;
      if (st) rows.push([t('usage.subTokens'), t('usage.subTokensVal', { total: fmtTok(st.total), input: fmtTok(st.input), output: fmtTok(st.output), cache: fmtTok(st.cacheCreation + st.cacheRead) })]);
    }
    if (!rows.length && a.kind === 'session' && !a.demo) rows.push([t('usage.usage'), t('usage.pending'), 'muted']);
    return rows;
  }

  $('#detailClose').onclick = closeDetail;
  document.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape') closeDetail();
  });
  setInterval(() => state.detail && renderDetail(), 5000);

  // ------------------------------------------------------------ legend

  const LEGEND = ['hobbit', 'dwarf', 'wizard', 'scout', 'painter', 'troll', 'beacon', 'campfire', 'eagle'];
  const legendCanvases = [];
  const legendList = $('#legendList');
  function renderLegend() {
    legendCanvases.length = 0;
    const items = LEGEND.map((kind) => {
      const li = el('li');
      const cv = el('canvas');
      legendCanvases.push([cv, kind]);
      const txt = el('span');
      txt.append(el('b', null, t('legend.' + kind)), document.createTextNode(t('legend.sep') + t('legend.' + kind + '.d')));
      li.append(cv, txt);
      const g = gl('legend.' + kind);
      if (g) li.title = `${g}${t('legend.sep')}${gl('legend.' + kind + '.d')}`;
      return li;
    });
    legendList.replaceChildren(...items);
    drawLegend();
  }
  function drawLegend() {
    const now = performance.now() / 1000;
    for (const [cv, kind] of legendCanvases) Sprites.drawIcon(cv, kind, now, 2);
  }
  renderLegend();
  setInterval(() => {
    if (prefs.legend) drawLegend();
  }, 200);
  function applyLegend() {
    $('#legend').classList.toggle('collapsed', !prefs.legend);
    $('#legendToggle').textContent = `${I18N.title(t('legend.title'))} ${prefs.legend ? '▾' : '▸'}`;
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
    b.textContent = t(on ? 'btn.demoOn' : 'btn.demoOff');
    b.title = gl(on ? 'btn.demoOn' : 'btn.demoOff') || '';
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
    const b = $('#btnSound');
    b.textContent = '🔊';
    b.classList.toggle('off', prefs.mute);
    b.setAttribute('aria-pressed', String(prefs.mute));
    b.title = tt(prefs.mute ? 'sound.allOff' : 'sound.allOn');
    Sound.setMuted(prefs.mute);
    Sound.sfx.setEnabled(prefs.sfx);
    syncSoundPanel();
  }
  /** 🔊 button: cuts (or brings back) everything, music and effects. */
  function toggleMute() {
    prefs.mute = !prefs.mute;
    savePrefs();
    applySound();
    if (!prefs.mute) beep();
  }
  /** Effects only (settings panel). */
  function toggleSfx() {
    prefs.sfx = !prefs.sfx;
    savePrefs();
    applySound();
    beep();
  }
  onPress($('#btnSound'), toggleMute, openSoundPanel);

  /** textOnly: language change, the music itself is left alone. */
  function applyMusic(textOnly) {
    $('#btnMusic').textContent = '🎵';
    $('#btnMusic').classList.toggle('off', !prefs.music);
    $('#btnMusic').setAttribute('aria-pressed', String(prefs.music));
    $('#btnMusic').title = prefs.music ? tt('sound.musicOn') : tt('sound.musicOff');
    if (textOnly === true) syncSoundPanel();
    else if (prefs.music) Sound.music.start();
    else Sound.music.stop();
    syncSoundPanel();
  }
  function toggleMusic() {
    prefs.music = !prefs.music;
    savePrefs();
    applyMusic();
  }
  onPress($('#btnMusic'), toggleMusic, openSoundPanel);

  // ------------------------------------------------------------ sound settings (🔊 right click / long press)

  /** Click = toggle; right click or long press (touch) = settings panel. */
  function onPress(btn, click, menu) {
    let timer = null;
    let longFired = false;
    btn.addEventListener('contextmenu', (ev) => {
      ev.preventDefault();
      menu(btn);
    });
    btn.addEventListener('pointerdown', (ev) => {
      if (ev.button !== 0) return;
      longFired = false;
      clearTimeout(timer);
      timer = setTimeout(() => {
        longFired = true;
        menu(btn);
      }, 550);
    });
    for (const t of ['pointerup', 'pointerleave', 'pointercancel']) btn.addEventListener(t, () => clearTimeout(timer));
    btn.addEventListener('click', () => {
      if (longFired) {
        longFired = false;
        return;
      }
      click();
    });
  }

  const soundPanel = (() => {
    const box = el('div', 'sound-panel panel');
    box.id = 'soundPanel';
    box.hidden = true;
    box.setAttribute('role', 'dialog');
    box.dataset.i18nAria = 'sound.panelTitle';
    const head = el('div', 'sp-head');
    const x = el('button', 'btn small ghost', '×');
    x.type = 'button';
    x.dataset.i18nTitle = 'sound.close';
    x.onclick = closeSoundPanel;
    head.append(tel('b', null, 'sound.panelTitle', true), x);

    const sliders = {};
    const slider = (key, text) => {
      const row = el('label', 'sp-row');
      const input = el('input');
      input.type = 'range';
      input.min = '0';
      input.max = '100';
      input.step = '1';
      input.id = 'vol-' + key;
      input.dataset.i18nAria = text;
      const out = el('output', 'sp-val');
      input.addEventListener('input', () => {
        prefs[key] = Number(input.value) / 100;
        out.textContent = input.value;
        applyLevels();
      });
      input.addEventListener('change', savePrefs);
      const lab = tel('span', 'sp-label', text);
      lab.dataset.i18nGloss = '';
      row.append(lab, input, out);
      sliders[key] = { input, out };
      return row;
    };
    const check = (text, get, toggle) => {
      const row = el('label', 'sp-check');
      const input = el('input');
      input.type = 'checkbox';
      input.addEventListener('change', () => {
        if (input.checked !== get()) toggle();
      });
      const lab = tel('span', null, text);
      lab.dataset.i18nGloss = '';
      row.append(input, document.createTextNode(' '), lab);
      return { row, input, get };
    };
    const muteCheck = check('sound.muteToggle', () => prefs.mute, toggleMute);
    const sfxCheck = check('sound.sfxToggle', () => prefs.sfx, toggleSfx);
    const musicCheck = check('sound.musicToggle', () => prefs.music, toggleMusic);

    const src = el('div', 'sp-src');
    const srcName = el('b');
    src.append(tel('span', null, 'sound.musicSource'), document.createTextNode(' '), srcName);
    const choose = tel('button', 'btn small', 'sound.chooseMusic');
    choose.type = 'button';
    const back = tel('button', 'btn small', 'sound.backToGenerated');
    back.type = 'button';
    const file = el('input');
    file.type = 'file';
    file.accept = 'audio/*';
    file.hidden = true;
    choose.onclick = () => {
      if (NATIVE) sendNative({ type: 'music', action: 'choose' });
      else file.click();
    };
    back.onclick = () => {
      if (NATIVE) sendNative({ type: 'music', action: 'reset' });
      else useGeneratedMusic(true);
    };
    file.addEventListener('change', () => {
      const f = file.files && file.files[0];
      file.value = '';
      if (!f) return;
      // Read in place for this session only: never uploaded, never stored.
      Sound.music.setSource({ url: URL.createObjectURL(f), name: f.name, revoke: true });
      musicChosen(f.name);
    });
    const buttons = el('div', 'sp-buttons');
    buttons.append(choose, back, file);
    const hint = tel('p', 'sp-hint', NATIVE ? 'sound.hintApp' : 'sound.hintBrowser');
    hint.dataset.i18nGloss = '';

    box.append(head, slider('volume', 'sound.volMaster'), slider('musicVolume', 'sound.volMusic'), slider('sfxVolume', 'sound.volSfx'),
      muteCheck.row, sfxCheck.row, musicCheck.row, src, buttons, hint);
    document.body.append(box);
    applyStatic(box);
    return { box, sliders, checks: [muteCheck, sfxCheck, musicCheck], srcName, back };
  })();

  function applyLevels() {
    Sound.setLevels({ volume: prefs.volume, music: prefs.musicVolume, sfx: prefs.sfxVolume });
  }

  function syncSoundPanel() {
    if (!soundPanel) return;
    for (const [k, s] of Object.entries(soundPanel.sliders)) {
      const v = String(Math.round(prefs[k] * 100));
      if (document.activeElement !== s.input) s.input.value = v;
      s.out.textContent = v;
    }
    for (const c of soundPanel.checks) c.input.checked = c.get();
    const custom = Sound.music.source === 'custom';
    soundPanel.srcName.textContent = custom ? t('sound.srcCustom', { name: Sound.music.customName || t('sound.localFile') }) : t('sound.srcGenerated');
    soundPanel.srcName.title = (custom ? gl('sound.srcCustom', { name: Sound.music.customName || gl('sound.localFile') }) : gl('sound.srcGenerated')) || '';
    soundPanel.back.disabled = !custom;
  }

  function openSoundPanel(btn) {
    syncSoundPanel();
    const box = soundPanel.box;
    box.hidden = false;
    const r = (btn || $('#btnSound')).getBoundingClientRect();
    const w = box.offsetWidth;
    box.style.top = Math.round(r.bottom + 8) + 'px';
    box.style.left = Math.round(Math.max(8, Math.min(window.innerWidth - w - 8, r.right - w))) + 'px';
  }
  function closeSoundPanel() {
    soundPanel.box.hidden = true;
  }
  document.addEventListener('pointerdown', (ev) => {
    if (soundPanel.box.hidden) return;
    if (soundPanel.box.contains(ev.target) || ev.target.closest('#btnSound, #btnMusic')) return;
    closeSoundPanel();
  }, true);
  document.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape' && !soundPanel.box.hidden) closeSoundPanel();
  });

  /** A custom track was picked: switch the music on so it is heard. */
  function musicChosen(name) {
    flashT('good', 'sound.musicPicked', { name });
    if (!prefs.music) {
      prefs.music = true;
      savePrefs();
    }
    applyMusic();
  }
  function useGeneratedMusic(announce) {
    Sound.music.setSource(null);
    if (announce) flashT('', 'sound.musicBack');
    syncSoundPanel();
  }
  Sound.music.onCustomError((name) => {
    flashT('bad', 'sound.musicError', { name: name || t('sound.yourMusic') });
    syncSoundPanel();
  });

  /** The server serves the track chosen in the macOS app (GET /user-music), if any. */
  async function loadServerMusic(announce) {
    try {
      const r = await fetch('user-music/info', { cache: 'no-store' });
      if (!r.ok) return;
      const info = await r.json();
      if (info && info.available) {
        Sound.music.setSource({ url: `user-music?v=${Number(info.version) || 0}`, name: info.name });
        if (announce) musicChosen(info.name);
      } else if (Sound.music.source === 'custom' && /^user-music/.test(currentMusicUrl)) {
        useGeneratedMusic(announce);
      }
      currentMusicUrl = info && info.available ? 'user-music' : '';
    } catch {
      /* older server: no custom music */
    }
    syncSoundPanel();
  }
  let currentMusicUrl = '';

  applyLevels();
  applySound();
  applyMusic();
  loadServerMusic(false);

  // ------------------------------------------------------------ notifications (📣)

  let flashTimer = null;
  /** Small status message at the bottom of the map. */
  function flash(text, kind, glossText) {
    const f = $('#flash');
    f.textContent = text;
    withGlossLine(f, glossText);
    f.className = 'flash panel' + (kind ? ' ' + kind : '');
    f.hidden = false;
    clearTimeout(flashTimer);
    flashTimer = setTimeout(() => {
      f.hidden = true;
    }, 6000);
  }

  /** flash() of a key, with its French gloss in an invented language. */
  function flashT(kind, key, params) {
    flash(t(key, params), kind, gl(key, params));
  }

  const NOTIF_STATE = {
    granted: 'on', authorized: 'on', provisional: 'on', ephemeral: 'on', denied: '', default: '', notDetermined: '',
  };
  function setNotifButton(st) {
    const b = $('#btnNotif');
    const known = Object.prototype.hasOwnProperty.call(NOTIF_STATE, st);
    b.classList.toggle('on', NOTIF_STATE[st] === 'on');
    b.title = known ? tt('notif.' + st) : tt('notif.generic');
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
    if (msg && msg.type === 'lang') {
      // Language chosen in the menu bar of the app.
      if (I18N.isLang(msg.lang) && msg.lang !== I18N.getLang()) setLanguage(msg.lang, 'native');
      sendNative({ type: 'log', message: `page: langue reçue du natif = ${msg.lang}` });
      return;
    }
    if (msg && msg.type === 'music') {
      // The app registered (or cleared) the track on the server: reload the source.
      sendNative({ type: 'log', message: `page: musique perso ${msg.source === 'custom' ? 'choisie' : 'retirée'}` });
      if (msg.source === 'custom') loadServerMusic(true);
      else {
        useGeneratedMusic(true);
        currentMusicUrl = '';
      }
      return;
    }
    if (!msg || msg.type !== 'notif') return;
    console.log('[lotr] état des notifications reçu du natif :', msg.state, msg.action || '');
    sendNative({ type: 'log', message: `page: état des notifications reçu = ${msg.state} (action ${msg.action || 'status'}${msg.tested ? ', test envoyé' : ''})` });
    setNotifButton(msg.state);
    if (msg.action !== 'request') return;
    if (msg.state === 'denied') {
      flashT('bad', 'notif.nativeDenied');
    } else if (msg.tested) {
      flashT('good', 'notif.nativeTested');
    } else if (msg.state === 'notDetermined') {
      flashT('bad', 'notif.nativeNotDetermined');
    }
  };

  function browserTest() {
    try {
      const n = new Notification(t('notif.testTitle'), { body: t('notif.testBody'), tag: 'lotr-test' });
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
      flashT(ok ? 'good' : 'bad', ok ? 'notif.browserTested' : 'notif.browserTestRefused');
    } else if (st === 'denied') {
      flashT('bad', 'notif.browserDenied');
    } else {
      flashT('', 'notif.browserDefault');
    }
  };
  applyNotif();

  // Inside the app: report the audio state to server.log (no gesture ever happened at that point).
  if (NATIVE) {
    const audioLine = (why) => {
      const st = Sound.status();
      sendNative({ type: 'log', message: `page: audio ${why} : contexte ${st.state}, geste ${st.hadGesture ? 'oui' : 'non'}, `
        + `t=${st.currentTime.toFixed(1)} s, page ${st.visibility}, musique ${st.musicWanted ? 'on' : 'off'} (${st.source}`
        + `${st.generatedPlaying ? ', générée en cours' : ''}${st.customPlaying ? ', perso en cours' : ''}), notes ${st.notes}, effets ${st.sfx}` });
    };
    audioLine('au chargement');
    setTimeout(() => audioLine('après 3 s'), 3000);
    Sound.onStateChange(() => audioLine('changement d\'état'));
    if (window.LOTRNative.audioDebug) setInterval(() => audioLine('suivi'), 20000);
    if (window.LOTRNative.audioDebug === 'music') Sound.music.start(); // diagnostic launch only, prefs untouched
  }

  function applyNight() {
    scene.nightEnabled = prefs.night;
    $('#btnNight').classList.toggle('on', prefs.night);
    $('#btnNight').title = tt(prefs.night ? 'btn.nightOn' : 'btn.nightOff');
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

  // ------------------------------------------------------------ language

  // Choice: prefs.lang; inside the app, the language remembered by the app (injected before the page
  // loads) wins, since the app and the page keep each other informed; else navigator.language.
  function initialLang() {
    const nat = NATIVE && window.LOTRNative.lang;
    if (NATIVE && I18N.isLang(nat)) return nat;
    if (I18N.isLang(prefs.lang)) return prefs.lang;
    return I18N.detect(navigator.language);
  }

  const langBtn = $('#btnLang');
  const langMenu = $('#langMenu');
  function renderLangMenu() {
    const cur = I18N.getLang();
    const items = [];
    for (const l of I18N.LANGS) {
      if (l.code === 'elf') items.push(el('div', 'lang-sep'));
      const b = el('button', 'lang-item');
      b.type = 'button';
      b.setAttribute('role', 'menuitemradio');
      b.setAttribute('aria-checked', String(l.code === cur));
      b.lang = l.fantasy ? 'fr' : l.code;
      b.append(el('span', 'flag', l.flag), el('span', null, l.native ? `${l.name} — ${l.native}` : l.name));
      b.onclick = () => {
        closeLangMenu();
        setLanguage(l.code, 'page');
      };
      items.push(b);
    }
    langMenu.replaceChildren(...items);
    langMenu.setAttribute('aria-label', t('lang.menu'));
  }
  function openLangMenu() {
    renderLangMenu();
    langMenu.hidden = false;
    langBtn.setAttribute('aria-expanded', 'true');
    const cur = langMenu.querySelector('[aria-checked="true"]');
    if (cur) cur.focus();
  }
  function closeLangMenu() {
    langMenu.hidden = true;
    langBtn.setAttribute('aria-expanded', 'false');
  }
  langBtn.onclick = () => (langMenu.hidden ? openLangMenu() : closeLangMenu());
  document.addEventListener('pointerdown', (ev) => {
    if (!langMenu.hidden && !ev.target.closest('.lang-wrap')) closeLangMenu();
  }, true);
  document.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape' && !langMenu.hidden) {
      closeLangMenu();
      langBtn.focus();
    }
  });

  /** Fonts with the glyphs of the language (canvas text needs them loaded before drawing). */
  function loadFonts(lang) {
    if (!document.fonts || !document.fonts.load) return;
    const wants = lang === 'ja' ? ['16px DotGothic16'] : lang === 'dwarf' ? ['16px "Noto Sans Runic"'] : [];
    const sample = lang === 'ja' ? '中つ国の地図ホビット' : 'ᚲᚨᚱᛏᛖ';
    for (const f of wants) document.fonts.load(f, sample).catch(() => {});
  }

  function applyLanguage() {
    const lang = I18N.getLang();
    const info = I18N.BY_CODE[lang];
    document.documentElement.lang = info.fantasy ? 'fr' : lang;
    document.documentElement.dataset.lang = lang;
    langBtn.textContent = info.flag;
    langBtn.title = `${tt('lang.title')} : ${info.native ? `${info.name} — ${info.native}` : info.name}`;
    loadFonts(lang);
    applyStatic(document);
    const empty = $('#emptyText');
    const code = el('code', null, 'npm run install-hooks');
    empty.replaceChildren(...fill(t('empty.text'), { demo: el('em', null, t('empty.demo')), cmd: code }));
    withGlossLine(empty, gl('empty.text', { demo: gl('empty.demo'), cmd: 'npm run install-hooks' }));
    $('#emptyTitle').textContent = t('empty.title');
    $('#emptyTitle').title = gl('empty.title') || '';
    scene.animSpeed = lang === 'ent' ? 0.7 : 1; // the Ents take their time (animations only)
    if (hintBox) hintBox.hidden = true;
    filterSig = '';
    applyLegend();
    renderLegend();
    setDemo(state.demo);
    applySound();
    applyMusic(true);
    applyNight();
    setConn(connOk);
    const nb = $('#btnNotif');
    if (nb.dataset.state) setNotifButton(nb.dataset.state);
    renderReserves();
    renderFeeds();
    renderSummary();
    scheduleUI();
    if (!langMenu.hidden) renderLangMenu();
  }

  /** from: 'page' (menu of the page), 'native' (menu bar of the app), 'init'. */
  function setLanguage(lang, from) {
    if (!I18N.isLang(lang)) return;
    if (from !== 'init') {
      prefs.lang = lang;
      savePrefs();
    }
    I18N.setLang(lang);
    applyLanguage();
    // The app uses the same language for its menus, notifications and alerts.
    if (NATIVE && from !== 'native') sendNative({ type: 'lang', lang });
  }

  I18N.setLang(initialLang());
  applyLanguage();
  if (NATIVE) {
    sendNative({ type: 'log', message: `page: langue au chargement = ${I18N.getLang()} (app ${window.LOTRNative.lang || '?'}, page ${prefs.lang || '?'})` });
    sendNative({ type: 'lang', lang: I18N.getLang() });
  }

  renderFeeds();
  renderSummary();
  setConn(false);
  connect();
})();
