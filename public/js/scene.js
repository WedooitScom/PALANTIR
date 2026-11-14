/* Scene: characters, effects, render loop and hit-testing on top of the map.
 * World is rendered at W x H "map pixels" into an offscreen canvas, then scaled
 * by an integer factor onto the visible canvas (image smoothing off).
 * Text (banners, labels, speech bubbles) is drawn in screen space for crispness.
 */
(function () {
  'use strict';

  const M = window.LOTRMap;
  const S = window.Sprites;
  const I18N = window.LOTRI18N;
  const tr = (key, params) => I18N.t(key, params);
  const R = (msg, fallback) => (msg && msg.key ? I18N.render(msg) : fallback || '');
  // Canvas fonts: glyph fallbacks for Japanese (DotGothic16) and runes (Noto Sans Runic).
  const FB = ', "DotGothic16", "Noto Sans Runic", monospace';
  const { W, H, TERRITORIES, TERR_BY_KEY } = M;

  const SLOTS = [[-12, 4], [12, 4], [-7, 9], [8, 9], [-16, -2], [16, -2], [0, 11], [-3, -8], [19, 8], [-19, 8]];
  const AVATARS = ['hobbit', 'dwarf', 'wizard', 'scout', 'painter', 'troll'];

  const STATUS = {
    coding: { label: 'FORGE', color: '#d9791f', rank: 6 },
    thinking: { label: 'MÉDITE', color: '#7d68c9', rank: 3 },
    running: { label: 'COMMANDES', color: '#5f8a3e', rank: 5 },
    designing: { label: 'PEINT', color: '#c64a8c', rank: 4 },
    talking: { label: 'PARLEMENTE', color: '#3f83b8', rank: 2 },
    waiting: { label: 'ATTEND TA RÉPONSE', color: '#d8321f', rank: 7 },
    idle: { label: 'REPOS', color: '#8b7b5b', rank: 1 },
    done: { label: 'PARTI', color: '#777', rank: 0 },
  };

  function roleAvatar(role) {
    return AVATARS.includes(role) ? role : 'dwarf';
  }
  function workFor(a) {
    switch (a.status) {
      case 'coding': return 'dwarf';
      case 'thinking': return a.activity === 'research' ? 'scout' : 'wizard';
      case 'designing': return 'painter';
      case 'running': return 'troll';
      default: return null;
    }
  }
  function hashStr(s) {
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

  // Model badge: letter + colour per family, full name in the tooltip.
  const MODEL_FAMILIES = [
    [/fable/i, 'F', '#2f8f83', 'Fable'],
    [/opus/i, 'O', '#b5502a', 'Opus'],
    [/sonnet/i, 'S', '#3f6fb6', 'Sonnet'],
    [/haiku/i, 'H', '#5f8a3e', 'Haiku'],
  ];
  function modelInfo(a) {
    const m = a && a.usage && a.usage.model;
    const id = (m && m.id) || (a && a.tokens && a.tokens.model) || '';
    const name = (m && m.name) || '';
    const key = name || id;
    if (!key) return null;
    const fam = MODEL_FAMILIES.find((f) => f[0].test(key) || f[0].test(id));
    const full = name && id && name !== id ? `${name} (${id})` : key;
    if (fam) return { letter: fam[1], color: fam[2], family: fam[3], full };
    return { letter: (key.replace(/^claude-/i, '')[0] || '?').toUpperCase(), color: '#7a6a55', family: key, full };
  }
  const STARVED_PCT = 100;

  // ------------------------------------------------ marching troops (new subagents)
  // Waypoints of the roads between the territories, so that troops go round the mountains
  // (High Pass, mines of Moria, Gap of Rohan, the pass south of the Ephel Dúath).
  const ROUTE_NODES = {
    havens: [54, 66], shire: [66, 88], bree: [100, 77], rivendell: [134, 59],
    highPass: [157, 57], anduin: [178, 64], mirkwood: [240, 60], erebor: [300, 59],
    eregion: [124, 98], moria: [146, 106], dimrill: [168, 104], lorien: [190, 99],
    westVale: [140, 130], gap: [167, 144], isengard: [159, 150], rohan: [206, 127],
    road1: [214, 140], road2: [226, 160], gondor: [236, 173], ithilien: [252, 196],
    pass: [266, 214], gorgoroth: [282, 206], mordor: [294, 194],
  };
  const ROUTE_EDGES = [
    ['havens', 'shire'], ['shire', 'bree'], ['bree', 'rivendell'], ['rivendell', 'highPass'], ['highPass', 'anduin'],
    ['anduin', 'mirkwood'], ['mirkwood', 'erebor'], ['bree', 'eregion'], ['shire', 'eregion'], ['eregion', 'moria'],
    ['moria', 'dimrill'], ['dimrill', 'lorien'], ['anduin', 'lorien'], ['moria', 'westVale'], ['eregion', 'westVale'],
    ['westVale', 'gap'], ['gap', 'isengard'], ['gap', 'rohan'], ['lorien', 'rohan'], ['rohan', 'road1'],
    ['road1', 'road2'], ['road2', 'gondor'], ['gondor', 'ithilien'], ['ithilien', 'pass'], ['pass', 'gorgoroth'],
    ['gorgoroth', 'mordor'],
  ];
  const ROUTE_ADJ = {};
  for (const [a, b] of ROUTE_EDGES) {
    const d = Math.hypot(ROUTE_NODES[a][0] - ROUTE_NODES[b][0], ROUTE_NODES[a][1] - ROUTE_NODES[b][1]);
    (ROUTE_ADJ[a] = ROUTE_ADJ[a] || []).push([b, d]);
    (ROUTE_ADJ[b] = ROUTE_ADJ[b] || []).push([a, d]);
  }
  const routeCache = new Map();
  /** Shortest chain of waypoint names between two nodes (Dijkstra on a tiny graph, cached). */
  function routeBetween(from, to) {
    const key = from + '>' + to;
    if (routeCache.has(key)) return routeCache.get(key);
    const dist = { [from]: 0 };
    const prev = {};
    const todo = new Set(Object.keys(ROUTE_NODES));
    while (todo.size) {
      let u = null;
      for (const n of todo) if (dist[n] != null && (u === null || dist[n] < dist[u])) u = n;
      if (u === null || u === to) break;
      todo.delete(u);
      for (const [v, d] of ROUTE_ADJ[u] || []) {
        if (dist[v] == null || dist[u] + d < dist[v]) {
          dist[v] = dist[u] + d;
          prev[v] = u;
        }
      }
    }
    const out = [];
    if (dist[to] != null) for (let n = to; n; n = prev[n]) out.unshift(n);
    routeCache.set(key, out);
    return out;
  }
  const MAX_TROOPS = 8;
  const TROOP_GAP = 7; // map px between the members of a troop
  const TROOP_FADE = 0.7; // s, companions fading out at the arrival
  const SPAWN_FRESH_MS = 20000; // only subagents born this recently march (not a backlog after a hidden tab)

  /** Smooth polyline (Catmull-Rom) through the points, with cumulative lengths. */
  function smoothPath(pts) {
    const xs = [], ys = [], cum = [];
    let L = 0;
    const push = (x, y) => {
      if (xs.length) L += Math.hypot(x - xs[xs.length - 1], y - ys[ys.length - 1]);
      xs.push(x);
      ys.push(y);
      cum.push(L);
    };
    push(pts[0][0], pts[0][1]);
    for (let i = 0; i < pts.length - 1; i++) {
      const p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(pts.length - 1, i + 2)];
      const n = Math.max(2, Math.ceil(Math.hypot(p2[0] - p1[0], p2[1] - p1[1]) / 4));
      for (let k = 1; k <= n; k++) {
        const u = k / n, u2 = u * u, u3 = u2 * u;
        const cr = (a, b, c, d) => 0.5 * (2 * b + (-a + c) * u + (2 * a - 5 * b + 4 * c - d) * u2 + (-a + 3 * b - 3 * c + d) * u3);
        push(cr(p0[0], p1[0], p2[0], p3[0]), cr(p0[1], p1[1], p2[1], p3[1]));
      }
    }
    return { xs, ys, cum, L };
  }
  /** Point at arc length d along a smoothPath (written into out). */
  function pathAt(path, d, out) {
    const { xs, ys, cum, L } = path;
    d = clamp(d, 0, L);
    let lo = 0, hi = cum.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (cum[mid] < d) lo = mid;
      else hi = mid;
    }
    const seg = cum[hi] - cum[lo] || 1;
    const k = clamp((d - cum[lo]) / seg, 0, 1);
    out.x = xs[lo] + (xs[hi] - xs[lo]) * k;
    out.y = ys[lo] + (ys[hi] - ys[lo]) * k;
    out.dx = xs[hi] - xs[lo];
    return out;
  }

  // ------------------------------------------------ weather
  const RAIN_FADE = 0.8; // intensity per second (in and out)
  const DRIZZLE_DROPS = 46; // per rainy territory
  const MAP_RAIN_DROPS = 340; // rain over the whole map (several territories)
  const MORDOR_RAIN_DROPS = 60;
  const MORDOR = { x: 252, y: 124, w: W - 252, h: H - 124 };
  const STORM_PCT = 90;
  const DARK_PCT = 75;

  /** Small procedural cloud sprite (light top, dark underside). */
  function makeCloud(w, h, seed, top, bottom) {
    const cv = document.createElement('canvas');
    cv.width = w;
    cv.height = h;
    const c = cv.getContext('2d');
    const blobs = [];
    for (let b = 0; b < 4; b++) blobs.push([4 + M.hash2(b, seed, 1) * (w - 8), h / 2 + (M.hash2(b, seed, 2) - 0.3) * 2, 3 + M.hash2(b, seed, 3) * 5]);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let inside = false;
        for (const [bx, by, br] of blobs) if ((x - bx) ** 2 + ((y - by) * 1.6) ** 2 < br * br) inside = true;
        if (!inside) continue;
        c.fillStyle = y > h * 0.55 ? bottom : top;
        c.fillRect(x, y, 1, 1);
      }
    }
    return cv;
  }

  class Scene {
    constructor(canvas, opts) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.opts = opts || {};
      this.world = M.build(1337);
      this.frame = document.createElement('canvas');
      this.frame.width = W;
      this.frame.height = H;
      this.f = this.frame.getContext('2d');
      this.agents = new Map();
      this.entities = new Map();
      this.particles = [];
      this.flights = [];
      this.hover = null;
      this.selected = null;
      this.nightEnabled = true;
      this.forceNight = /[?&]night=1/.test(location.search);
      this.view = { s: 1, ox: 0, oy: 0, dpr: 1, cw: 0, ch: 0 };
      this.lastT = 0;
      this.startT = null;
      this.warm = false;
      this.active = new Set();
      this.usage = null; // { fivePct } set by the app
      this.hud = []; // screen-space hit boxes (lanterns, model badges)
      this.animSpeed = 1; // < 1 slows the characters down (ent language); data timers are untouched
      this.animT = 0;
      this.quiet = false; // set by quietSpawn(): what a snapshot brings appears in place
      this.tmpPt = { x: 0, y: 0, dx: 0 };
      // Weather: rain over the territories whose tests fail, storm over Mordor near the limits.
      this.weather = { rain: false, storm: false };
      this.rainK = new Map(); // territory key -> rain intensity (0..1, fades)
      this.rainKeys = new Set();
      this.rainAllK = 0;
      this.darkK = 0;
      this.stormK = 0;
      this.bolt = null;
      this.nextBoltAt = 0;
      this.boltPts = new Int16Array(24);
      const wf = /[?&]weather=(rain|storm|clear)/.exec(location.search);
      this.forceWeather = wf ? wf[1] : null; // testing: ?weather=rain|storm|clear
      this.rainClouds = [0, 1, 2].map((k) => makeCloud(24 + k * 4, 9, 50 + k, 'rgba(150,156,168,0.85)', 'rgba(104,110,124,0.88)'));
      this.stormClouds = [0, 1, 2].map((k) => makeCloud(30 + k * 5, 10, 70 + k, 'rgba(70,62,78,0.9)', 'rgba(38,32,44,0.92)'));
      const mq = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
      this.reduceMotion = !!(mq && mq.matches);
      if (mq && mq.addEventListener) mq.addEventListener('change', (ev) => (this.reduceMotion = ev.matches));

      this.resize();
      if (window.ResizeObserver) {
        const ro = new ResizeObserver(() => this.resize());
        ro.observe(canvas.parentElement);
        const title = canvas.parentElement.querySelector('.map-title');
        if (title) ro.observe(title); // runes / longer titles when the language changes
      }
      window.addEventListener('resize', () => this.resize());
      canvas.addEventListener('mousemove', (ev) => this.onMove(ev));
      canvas.addEventListener('mouseleave', () => {
        this.hover = null;
        if (this.opts.onHover) this.opts.onHover(null);
      });
      canvas.addEventListener('click', (ev) => {
        const hit = this.pick(ev.clientX, ev.clientY);
        if (this.opts.onPick) this.opts.onPick(hit);
      });
      requestAnimationFrame((ts) => this.loop(ts));
    }

    setAgents(map) {
      this.agents = map;
    }

    /** The agents of the next frame come from a snapshot: no marching troops for them. */
    quietSpawn() {
      this.quiet = true;
    }

    resize() {
      const parent = this.canvas.parentElement;
      const r = parent.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      const cw = Math.max(1, Math.floor(r.width * dpr));
      const ch = Math.max(1, Math.floor(r.height * dpr));
      this.canvas.width = cw;
      this.canvas.height = ch;
      this.canvas.style.width = r.width + 'px';
      this.canvas.style.height = r.height + 'px';
      // Band kept free at the top for the title above the map (#mapTitle).
      const title = parent.querySelector('.map-title');
      const th = title ? title.offsetHeight : 0;
      const top = title ? Math.min(ch / 3, Math.ceil((th + 14) * dpr)) : 0;
      const s = Math.max(1, Math.floor(Math.min(cw / W, (ch - top) / H)));
      this.view = { s, dpr, cw, ch, ox: Math.floor((cw - W * s) / 2), oy: top + Math.floor((ch - top - H * s) / 2) };
      // The title sits just above the map frame, whatever the window size.
      if (title) {
        const y = Math.max(4, Math.round(this.view.oy / dpr - th - 6));
        if (title.style.top !== y + 'px') title.style.top = y + 'px';
      }
    }

    // ------------------------------------------------ geometry

    terr(a) {
      return TERR_BY_KEY[a.territory] || TERRITORIES[0];
    }

    home(a, slot) {
      const T = this.terr(a);
      let x = T.cx, y = T.cy;
      const sid = a.kind === 'session' ? a.id : a.sessionId;
      // Several companies sharing a territory (more than 10 sessions).
      const peers = [];
      for (const b of this.agents.values()) if (b.kind === 'session' && b.status !== 'done' && b.territory === T.key) peers.push(b);
      if (peers.length > 1) {
        peers.sort((p, q) => p.startedAt - q.startedAt);
        const idx = Math.max(0, peers.findIndex((p) => p.id === sid));
        x += (idx - (peers.length - 1) / 2) * 22;
      }
      if (a.kind === 'subagent') {
        const o = SLOTS[slot % SLOTS.length];
        const k = 1 + Math.floor(slot / SLOTS.length) * 0.5;
        x += o[0] * k;
        y += o[1] * k;
      }
      return { x: clamp(x, 8, W - 8), y: clamp(y, 18, H - 5) };
    }

    // ------------------------------------------------ effects

    addFlight(fx) {
      const from = this.agents.get(fx.from);
      const src = this.entities.get(fx.from) || (from && this.home(from, 0));
      if (!src) return;
      let dst = null;
      if (fx.to) {
        const te = this.entities.get(fx.to);
        const ta = this.agents.get(fx.to);
        if (te) dst = { x: te.x, y: te.y - 10 };
        else if (ta) dst = this.home(ta, 0);
      }
      if (!dst) dst = { x: clamp(src.x + (Math.random() < 0.5 ? -90 : 90), -10, W + 10), y: -12 };
      const dist = Math.hypot(dst.x - src.x, dst.y - src.y);
      this.flights.push({ x0: src.x, y0: src.y - 12, x1: dst.x, y1: dst.y, t0: null, dur: clamp(dist / 45, 1.6, 6), to: fx.to, arc: Math.min(28, dist * 0.25) });
    }

    sparks(x, y, n, colors, spread) {
      for (let i = 0; i < n; i++) {
        this.particles.push({
          x, y,
          vx: (Math.random() - 0.5) * spread,
          vy: -Math.random() * spread * 0.8 - 4,
          g: 60,
          life: 0,
          max: 0.35 + Math.random() * 0.35,
          color: colors[(Math.random() * colors.length) | 0],
        });
      }
    }

    // ------------------------------------------------ loop

    loop(ts) {
      const real = ts / 1000;
      if (this.startT === null) this.startT = real;
      const realDt = Math.min(0.05, Math.max(0, real - (this.lastT || real)));
      this.lastT = real;
      if (!this.warm && real - this.startT > 0.6) this.warm = true;
      // Animation clock: real time scaled by animSpeed (walks, strikes, blinking, particles).
      const dt = realDt * this.animSpeed;
      this.animT += dt;
      try {
        this.render(this.animT, dt);
      } catch (e) {
        if (!this.errLogged) {
          this.errLogged = true;
          console.error(e);
        }
      }
      requestAnimationFrame((n) => this.loop(n));
    }

    computeActive() {
      const act = new Set();
      for (const a of this.agents.values()) if (a.kind === 'session' && a.status !== 'done' && a.territory) act.add(a.territory);
      this.active = act;
      return act;
    }

    updateEntities(t, dt) {
      const seen = new Set();
      for (const a of this.agents.values()) {
        if (a.status === 'done') continue;
        seen.add(a.id);
        let e = this.entities.get(a.id);
        if (!e) e = this.createEntity(a, t);
        e.agent = a;
        e.leaving = false;
      }
      for (const [id, e] of this.entities) {
        if (!seen.has(id)) {
          e.leaving = true;
          const a = this.agents.get(id);
          if (a) e.agent = a;
        }
        this.moveEntity(e, t, dt);
        if (e.alpha <= 0 && e.leaving) this.entities.delete(id);
      }
      this.quiet = false;
    }

    createEntity(a, t) {
      let slot = 0;
      if (a.kind === 'subagent') {
        const used = new Set();
        for (const o of this.entities.values()) {
          if (!o.leaving && o.agent.kind === 'subagent' && o.agent.sessionId === a.sessionId) used.add(o.slot);
        }
        while (used.has(slot)) slot++;
      }
      const home = this.home(a, slot);
      let x = home.x, y = home.y, alpha = this.warm ? 0 : 1;
      if (this.warm && a.kind === 'subagent') {
        const p = this.entities.get(a.parentId) || this.entities.get(a.sessionId);
        if (p) {
          x = p.x;
          y = p.y;
          alpha = 1;
        }
      }
      const e = {
        id: a.id, agent: a, slot, x, y, alpha, facing: 1, walking: false, leaving: false,
        seed: (hashStr(a.id) % 1000) / 1000, wander: null, wanderAt: 0, strike: -1, hStrike: -1,
        mailUntil: 0, helperWork: null, helperAlpha: 0, helperPos: null, troop: null,
      };
      if (this.wantsTroop(a)) this.startTroop(e, home, t);
      this.entities.set(a.id, e);
      return e;
    }

    /** A live, freshly spawned subagent marches from the Shire (unless the motion is reduced or too many already march). */
    wantsTroop(a) {
      if (!this.warm || this.quiet || this.reduceMotion || a.kind !== 'subagent') return false;
      if (!(Date.now() - (Number(a.startedAt) || 0) < SPAWN_FRESH_MS)) return false;
      let n = 0;
      for (const o of this.entities.values()) if (o.troop && !o.troop.arrivedAt) n++;
      return n < MAX_TROOPS;
    }

    /** Route from the Shire (or from the Havens when the company itself is in the Shire) to the post. */
    startTroop(e, home, t) {
      const key = this.terr(e.agent).key;
      const from = key === 'shire' ? 'havens' : 'shire';
      const names = ROUTE_NODES[key] ? routeBetween(from, key) : [from];
      const pts = names.map((n) => ROUTE_NODES[n]);
      if (!pts.length) pts.push(ROUTE_NODES[from]);
      // The territory's waypoint is its centre: end on the post itself instead.
      if (pts.length > 1 && names[names.length - 1] === key) pts.pop();
      pts.push([home.x, home.y]);
      const path = smoothPath(pts);
      if (path.L < 2) return;
      const n = e.seed < 0.5 ? 1 : 2;
      e.troop = { path, t0: t, dur: clamp(path.L / 42, 4, 8), n, d: 0, arrivedAt: 0, endX: home.x, endY: home.y };
      e.x = pts[0][0];
      e.y = pts[0][1];
      e.alpha = 0;
    }

    /** One step of a marching troop (animation clock: slower in Ent). */
    stepTroop(e, t, dt) {
      const tr = e.troop;
      const p = clamp((t - tr.t0) / tr.dur, 0, 1);
      const ease = 0.75 * p + 0.25 * p * p * (3 - 2 * p);
      tr.d = ease * tr.path.L;
      const pt = pathAt(tr.path, tr.d, this.tmpPt);
      if (Math.abs(pt.dx) > 0.05) e.facing = pt.dx < 0 ? -1 : 1;
      e.x = pt.x;
      e.y = pt.y;
      e.walking = true;
      e.alpha = Math.min(1, e.alpha + dt * 3);
      if (p >= 1) {
        tr.arrivedAt = t;
        e.walking = false;
      }
    }

    moveEntity(e, t, dt) {
      // A marching troop finishes its walk first (even if its subagent is already done).
      if (e.troop && !e.troop.arrivedAt) {
        this.stepTroop(e, t, dt);
        return;
      }
      if (e.troop && t - e.troop.arrivedAt > TROOP_FADE) e.troop = null;
      const a = e.agent;
      let target;
      let speed = 16;
      if (e.leaving) {
        const p = this.entities.get(a.parentId) || this.entities.get(a.sessionId);
        target = p && !p.leaving && p !== e ? { x: p.x + 5, y: p.y } : { x: e.x, y: e.y };
        speed = 22;
      } else {
        const home = this.home(a, e.slot);
        const T = this.terr(a);
        const work = workFor(a);
        const avatar = roleAvatar(a.role);
        let wr = null;
        if (this.starved(a)) wr = null;
        else if (a.kind === 'session' && ['talking', 'thinking', 'coding', 'running', 'designing'].includes(a.status)) wr = [4, 2];
        else if (work === 'scout' && avatar === 'scout') wr = [T.rx * 0.9, T.ry * 0.9];
        if (wr) {
          if (!e.wander || t > e.wanderAt) {
            e.wander = { x: home.x + (Math.random() * 2 - 1) * wr[0], y: home.y + (Math.random() * 2 - 1) * wr[1] };
            e.wanderAt = t + 2 + Math.random() * 3;
          }
          target = e.wander;
          speed = 7;
        } else {
          target = home;
          e.wander = null;
        }
      }
      const dx = target.x - e.x, dy = target.y - e.y;
      const dist = Math.hypot(dx, dy);
      if (dist > 0.5) {
        const st = Math.min(dist, speed * dt);
        e.x += (dx / dist) * st;
        e.y += (dy / dist) * st;
        e.walking = true;
        if (Math.abs(dx) > 0.3) e.facing = dx < 0 ? -1 : 1;
      } else {
        e.walking = false;
      }
      if (e.leaving) {
        if (dist <= 1.5) e.alpha -= dt * 1.8;
      } else if (e.alpha < 1) {
        e.alpha = Math.min(1, e.alpha + dt * 2);
      }
    }

    // ------------------------------------------------ render

    render(t, dt) {
      const f = this.f;
      const w = this.world;
      const active = this.computeActive();
      this.updateEntities(t, dt);

      f.drawImage(w.base, 0, 0);
      M.drawAmbient(f, w, t, dt);
      M.drawFog(f, w, t, active);

      const draws = [];
      const lights = [];

      // Beacons on occupied territories.
      for (const key of active) {
        const T = TERR_BY_KEY[key];
        if (!T) continue;
        let lit = false;
        for (const a of this.agents.values()) if (a.territory === key && a.status === 'waiting') lit = true;
        const [bx, by] = T.beacon;
        if (lit) lights.push([bx, by - 10], [bx - 1, by - 13]);
        draws.push({ y: by, fn: () => S.drawBeacon(f, bx, by, t, lit) });
      }

      // Hover / selection ring.
      const ringFor = (id, color) => {
        const e = this.entities.get(id);
        if (!e || e.leaving) return;
        f.fillStyle = color;
        const cx = Math.round(e.x), cy = Math.round(e.y) + 1;
        for (let a = 0; a < 360; a += 20) {
          const rx = Math.round(cx + Math.cos((a * Math.PI) / 180) * 6);
          const ry = Math.round(cy + Math.sin((a * Math.PI) / 180) * 2);
          f.fillRect(rx, ry, 1, 1);
        }
      };
      if (this.selected) ringFor(this.selected, '#ffe066');
      if (this.hover && this.hover.type === 'agent' && this.hover.id !== this.selected) ringFor(this.hover.id, '#fff6c8');

      for (const e of this.entities.values()) this.queueEntity(e, t, dt, draws, lights);
      draws.sort((p, q) => p.y - q.y);
      for (const d of draws) d.fn();

      this.drawParticles(f, dt);
      this.drawFlights(f, t);
      M.drawClouds(f, w, t, dt);
      this.updateWeather(dt);
      this.drawWeather(f, t);
      const amt = this.forceNight ? 0.38 : this.nightEnabled ? M.nightAmount(new Date()) : 0;
      M.drawNight(f, w, amt, t, lights);
      this.drawShadow(f, t);
      this.drawLightning(f, t, amt);

      // Blit.
      const c = this.ctx;
      const { s, ox, oy, cw, ch } = this.view;
      c.imageSmoothingEnabled = false;
      c.fillStyle = '#1d140c';
      c.fillRect(0, 0, cw, ch);
      c.drawImage(this.frame, ox, oy, W * s, H * s);
      this.drawOverlay(c, t);
    }

    /** 5 h limit used up: active characters (not those waiting for you) camp by a fire. */
    starved(a) {
      return !!(this.usage && this.usage.fivePct >= STARVED_PCT) && !['waiting', 'done', 'idle'].includes(a.status);
    }

    /** Shadow of Mordor: from 80 % of the 5 h limit, a dark red veil spreads from the east. */
    drawShadow(f, t) {
      const p = this.usage ? this.usage.fivePct : 0;
      if (!(p >= 80)) return;
      const k = clamp((p - 80) / 20, 0, 1);
      const reach = Math.round(W * (0.2 + 0.6 * k));
      const x0 = W - reach;
      if (!this.shadowGrad || this.shadowKey !== reach) {
        const g = f.createLinearGradient(x0 - 10, 0, W, 0);
        g.addColorStop(0, 'rgba(60,8,10,0)');
        g.addColorStop(0.12, `rgba(70,10,12,${0.28 + 0.14 * k})`);
        g.addColorStop(1, `rgba(90,12,8,${0.5 + 0.2 * k})`);
        this.shadowGrad = g;
        this.shadowKey = reach;
      }
      f.fillStyle = this.shadowGrad;
      for (let y = 0; y < H; y += 2) {
        // Ragged, slowly breathing front.
        const off = Math.round(Math.sin(y * 0.11 + t * 0.7) * 3 + M.hash2(0, y >> 2, 91) * 8 - 10);
        const x = Math.max(0, x0 + off);
        f.fillRect(x, y, W - x, 2);
      }
      // Embers drifting in the shadow.
      if (Math.random() < 0.25 + k * 0.5) {
        this.particles.push({ x: x0 + Math.random() * reach, y: H - Math.random() * H * 0.6, vx: -2 - Math.random() * 3, vy: -3 - Math.random() * 3, g: 0, life: 0, max: 1.2, color: 'rgba(255,90,40,0.8)' });
      }
    }

    queueEntity(e, t, dt, draws, lights) {
      const f = this.f;
      const a = e.agent;
      const fx = Math.round(e.x), fy = Math.round(e.y);
      const alpha = Math.max(0, Math.min(1, e.alpha));
      const avatar = roleAvatar(a.role);
      const starved = !e.leaving && this.starved(a);
      const work = e.leaving || starved ? null : workFor(a);
      const tt = t + e.seed * 10;
      e.helperPos = null;
      if (e.troop) this.queueTroop(e, t, dt, tt, alpha, draws);

      if (starved && !e.walking) {
        lights.push([fx + 7, fy - 4]);
        draws.push({
          y: fy,
          fn: () => {
            S.drawAvatar(f, avatar, fx, fy, tt, { pose: 'sit', alpha });
            S.drawCampfire(f, fx + 8, fy, tt, alpha);
          },
        });
      } else if (e.walking || e.leaving) {
        draws.push({ y: fy, fn: () => S.drawAvatar(f, avatar, fx, fy, tt, { walking: e.walking, flip: e.facing < 0, alpha, loupe: work === 'scout' }) });
      } else if (a.status === 'idle') {
        lights.push([fx + 7, fy - 4]);
        draws.push({
          y: fy,
          fn: () => {
            S.drawAvatar(f, avatar, fx, fy, tt, { pose: 'sit', alpha });
            S.drawCampfire(f, fx + 8, fy, tt, alpha);
            for (let i = 0; i < 3; i++) {
              const p = (t * 0.45 + i / 3 + e.seed) % 1;
              S.draw(f, 'glyph_z', fx + 2 + p * 5 + Math.sin(p * 6) * 1.2, fy - 14 - p * 9, { alpha: alpha * (1 - p) });
            }
          },
        });
        if (Math.random() < dt * 2) this.particles.push({ x: fx + 8, y: fy - 7, vx: 1 + Math.random(), vy: -5, g: 0, life: 0, max: 1.4, color: 'rgba(120,110,100,0.6)' });
      } else if (a.status === 'waiting') {
        const bob = Math.floor(t * 4) % 2;
        draws.push({
          y: fy,
          fn: () => {
            S.drawAvatar(f, avatar, fx, fy - bob, tt, { pose: 'wave', alpha });
            if (Math.floor(t * 3) % 3 !== 0) S.draw(f, 'glyph_excl', fx - 1, fy - 22, { alpha });
          },
        });
      } else if (a.status === 'talking') {
        draws.push({
          y: fy,
          fn: () => {
            S.drawAvatar(f, avatar, fx, fy, tt, { pose: 'wave', alpha });
            if (Math.floor(t * 2) % 2 === 0) S.draw(f, 'letter', fx + 4, fy - 12, { alpha });
          },
        });
      } else if (work && work === avatar) {
        draws.push({ y: fy, fn: () => this.drawWorker(work, fx, fy, tt, alpha, e, false) });
      } else {
        draws.push({ y: fy, fn: () => S.drawAvatar(f, avatar, fx, fy, tt, { alpha }) });
      }

      // Helper figure doing the actual work next to a character of another kind.
      // (Sessions keep their helper while the hobbit strolls around.)
      const helperOn = !e.leaving && work && work !== avatar && (a.kind === 'session' || !e.walking);
      if (!helperOn) {
        e.helperWork = null;
      } else {
        if (e.helperWork !== work) {
          e.helperWork = work;
          e.helperAlpha = 0;
        }
        e.helperAlpha = Math.min(1, e.helperAlpha + dt * 2.5);
        const base = a.kind === 'session' ? this.home(a, 0) : { x: fx, y: fy };
        const side = base.x > W - 24 ? -1 : 1;
        const hx = Math.round(base.x + 11 * side), hy = Math.round(base.y + 1);
        e.helperPos = { x: hx, y: hy };
        const ha = alpha * e.helperAlpha;
        draws.push({ y: hy, fn: () => this.drawWorker(work, hx, hy, tt + 0.37, ha, e, true) });
      }
    }

    /** Companions (porters) walking in file behind a marching subagent, a little dust, fade at the arrival. */
    queueTroop(e, t, dt, tt, alpha, draws) {
      const tr = e.troop;
      const f = this.f;
      const fade = tr.arrivedAt ? clamp(1 - (t - tr.arrivedAt) / TROOP_FADE, 0, 1) : 1;
      if (fade <= 0) return;
      const marching = !tr.arrivedAt;
      for (let i = 1; i <= tr.n; i++) {
        const back = tr.d - TROOP_GAP * i;
        const pt = pathAt(tr.path, back, this.tmpPt);
        const cx = Math.round(pt.x), cy = Math.round(pt.y);
        const flip = pt.dx < -0.05 || (Math.abs(pt.dx) <= 0.05 && e.facing < 0);
        // Companions appear as the troop leaves (they start bunched on the first waypoint).
        const ca = alpha * fade * clamp(tr.d / (TROOP_GAP * i), 0, 1);
        if (ca <= 0.02) continue;
        const ct = marching ? tt + i * 0.21 : 0;
        draws.push({ y: cy, fn: () => S.drawPorter(f, cx, cy, ct, { flip, alpha: ca, alt: i === 2 }) });
        if (marching && Math.random() < dt * 5) this.particles.push({ x: cx + (Math.random() - 0.5) * 4, y: cy, vx: (Math.random() - 0.5) * 3, vy: -2 - Math.random() * 2, g: 0, life: 0, max: 0.6 + Math.random() * 0.4, color: 'rgba(196,172,124,0.75)' });
      }
      if (marching && Math.random() < dt * 4) this.particles.push({ x: e.x + (Math.random() - 0.5) * 4, y: e.y, vx: -e.facing * (1 + Math.random() * 2), vy: -2 - Math.random() * 2, g: 0, life: 0, max: 0.6 + Math.random() * 0.4, color: 'rgba(196,172,124,0.75)' });
    }

    // ------------------------------------------------ weather

    /** Rain targets (sessions with failing tests) and the storm over Mordor (limits), with smooth fades. */
    updateWeather(dt) {
      const now = Date.now();
      const keys = this.rainKeys;
      keys.clear();
      const fw = this.forceWeather;
      if (fw !== 'clear') {
        for (const a of this.agents.values()) {
          if (a.kind !== 'session' || a.status === 'done' || !a.territory) continue;
          if (fw === 'rain' || (a.tests && a.tests.rainUntil > now)) keys.add(a.territory);
        }
      }
      const all = keys.size >= 2 || (fw === 'rain' && keys.size === 0);
      const step = dt * RAIN_FADE;
      this.rainAllK = clamp(this.rainAllK + (all ? step : -step), 0, 1);
      for (const k of keys) if (!this.rainK.has(k)) this.rainK.set(k, 0);
      for (const [k, v] of this.rainK) {
        const nv = clamp(v + (keys.has(k) && !all ? step : -step), 0, 1);
        if (nv <= 0 && !keys.has(k)) this.rainK.delete(k);
        else this.rainK.set(k, nv);
      }
      const u = this.usage;
      const p = fw === 'storm' ? 100 : fw === 'clear' ? 0 : u ? Math.max(u.fivePct || 0, u.sevenPct || 0) : 0;
      const darkTarget = p >= STORM_PCT ? 1 : p >= DARK_PCT ? 0.5 : 0;
      this.darkK = clamp(this.darkK + clamp(darkTarget - this.darkK, -step, step), 0, 1);
      this.stormK = clamp(this.stormK + (p >= STORM_PCT ? step : -step), 0, 1);
      this.weather.rain = keys.size > 0;
      this.weather.storm = p >= STORM_PCT;
    }

    /** Falling drops in a box, stateless (positions from the clock): no allocation, no particle to keep. */
    drawRain(f, x0, y0, w, h, n, t, seed) {
      if (this.reduceMotion) n = Math.round(n * 0.4);
      f.fillStyle = 'rgba(184,204,234,0.66)';
      for (let i = 0; i < n; i++) {
        const r1 = M.hash2(i, seed, 3), r2 = M.hash2(i, seed, 7);
        const yy = (r2 * h + t * (64 + r1 * 36)) % h;
        const x = Math.round(x0 + r1 * w - yy * 0.25);
        const y = Math.round(y0 + yy);
        f.fillRect(x, y, 1, 2);
        f.fillRect(x + 1, y - 1, 1, 1); // slanted streak
        if (yy > h - 2) f.fillRect(x - 1, y + 2, 3, 1); // splash
      }
    }

    /** Rain clouds and rain over the territories, storm clouds over Mordor (drawn before the night veil). */
    drawWeather(f, t) {
      // Mordor: darker sky from 75 %, storm (clouds, rain) from 90 %.
      if (this.darkK > 0.01) {
        const k = this.darkK;
        f.fillStyle = `rgba(20,12,28,${0.26 * k})`;
        for (let y = MORDOR.y; y < H; y += 3) {
          const off = Math.round(Math.sin(y * 0.13 + t * 0.4) * 3 + M.hash2(1, y >> 3, 17) * 6);
          f.fillRect(MORDOR.x + off, y, W - MORDOR.x - off, 3);
        }
        const drift = this.reduceMotion ? 0 : t * 1.5;
        f.globalAlpha = Math.min(1, 0.45 * k + 0.55 * this.stormK);
        for (let i = 0; i < 4; i++) {
          const c = this.stormClouds[i % 3];
          const span = MORDOR.w + c.width;
          const x = MORDOR.x - c.width / 2 + ((i * 37 + drift) % span) - 10;
          f.drawImage(c, Math.round(x), MORDOR.y + 6 + ((i * 11) % 22));
        }
        f.globalAlpha = 1;
      }
      if (this.stormK > 0.01) this.drawRain(f, MORDOR.x, MORDOR.y + 14, MORDOR.w, MORDOR.h - 14, Math.round(MORDOR_RAIN_DROPS * this.stormK), t, 5);
      // A rain cloud over each territory whose tests fail.
      let idx = 0;
      for (const [key, k] of this.rainK) {
        const T = TERR_BY_KEY[key];
        if (!T || k <= 0.01) continue;
        const w = (T.rx + 14) * 2;
        const x0 = T.cx - w / 2;
        const top = T.cy - 38;
        this.drawRain(f, x0 + 3, top + 6, w - 2, T.cy + T.ry + 4 - (top + 6), Math.round(DRIZZLE_DROPS * k), t, 11 + idx++);
        f.globalAlpha = k;
        const sway = this.reduceMotion ? 0 : Math.sin(t * 0.3 + T.cx) * 2;
        f.drawImage(this.rainClouds[0], Math.round(x0 + sway), top - 2);
        f.drawImage(this.rainClouds[1], Math.round(x0 + w - this.rainClouds[1].width - sway), top);
        f.globalAlpha = 1;
      }
      // Several territories: it rains over the whole map, under a grey veil.
      if (this.rainAllK > 0.01) {
        f.fillStyle = `rgba(52,62,82,${0.14 * this.rainAllK})`;
        f.fillRect(0, 0, W, H);
        this.drawRain(f, 0, 0, W + 40, H, Math.round(MAP_RAIN_DROPS * this.rainAllK), t, 3);
      }
    }

    /** Lightning over Mordor during the storm, with a light flash (after the night veil: brighter at night). */
    drawLightning(f, t, night) {
      if (this.reduceMotion || this.stormK < 0.6) {
        this.bolt = null;
        return;
      }
      if (!this.bolt && t >= this.nextBoltAt) {
        const pts = this.boltPts;
        let x = MORDOR.x + 14 + Math.random() * (MORDOR.w - 28);
        let y = MORDOR.y + 14;
        const ground = y + 40 + Math.random() * 40;
        let n = 0;
        while (n < pts.length / 2 && y < ground) {
          pts[n * 2] = Math.round(x);
          pts[n * 2 + 1] = Math.round(y);
          n++;
          x += (Math.random() - 0.5) * 9;
          y += 5 + Math.random() * 6;
        }
        this.bolt = { t0: t, n };
        this.nextBoltAt = t + 3.5 + Math.random() * 6;
      }
      const b = this.bolt;
      if (!b) return;
      const age = t - b.t0;
      if (age > 0.32) {
        this.bolt = null;
        return;
      }
      // Light flash, local to Mordor.
      f.fillStyle = `rgba(255,248,226,${(0.16 + 0.08 * night) * (1 - age / 0.32)})`;
      f.fillRect(MORDOR.x, MORDOR.y, MORDOR.w, MORDOR.h);
      if (age < 0.08 || (age > 0.14 && age < 0.22)) {
        const pts = this.boltPts;
        f.fillStyle = '#fff6c8';
        for (let i = 0; i < b.n - 1; i++) {
          const x0 = pts[i * 2], y0 = pts[i * 2 + 1], x1 = pts[i * 2 + 2], y1 = pts[i * 2 + 3];
          const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)) || 1;
          for (let k = 0; k <= steps; k++) f.fillRect(Math.round(x0 + ((x1 - x0) * k) / steps), Math.round(y0 + ((y1 - y0) * k) / steps), 1, 1);
        }
      }
    }

    drawWorker(work, x, y, tt, alpha, e, helper) {
      const f = this.f;
      if (work === 'scout') {
        const sway = helper ? Math.round(Math.sin(tt * 0.9) * 3) : 0;
        const moving = helper && Math.abs(Math.cos(tt * 0.9)) > 0.3;
        S.drawWork(f, 'scout', x + sway, y, tt, { walking: moving, flip: helper && Math.cos(tt * 0.9) < 0, alpha });
        return;
      }
      S.drawWork(f, work, x, y, tt, { alpha });
      if (work === 'wizard') {
        const q = Math.floor(tt / 2) % 3 === 0;
        S.draw(f, q ? 'bubble_q' : 'bubble_dots', x + 3, y - 24, { alpha });
      }
      if (work === 'dwarf' || work === 'troll') {
        const off = work === 'troll' ? 0.2 : 0;
        const idx = S.strikeIndex(tt + off);
        const key = helper ? 'hStrike' : 'strike';
        if (S.strikeDown(tt + off) && e[key] !== idx && alpha > 0.5) {
          e[key] = idx;
          if (work === 'dwarf') this.sparks(x + 8, y - 5, 6, ['#ffe066', '#ff8c1a', '#fff6c8'], 26);
          else this.sparks(x + 8, y - 5, 4, ['#9a968f', '#625f5a', '#c9c3b6'], 18);
        }
      }
    }

    drawParticles(f, dt) {
      for (let i = this.particles.length - 1; i >= 0; i--) {
        const p = this.particles[i];
        p.life += dt;
        if (p.life >= p.max) {
          this.particles.splice(i, 1);
          continue;
        }
        p.vy += p.g * dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        f.globalAlpha = 1 - p.life / p.max;
        f.fillStyle = p.color;
        f.fillRect(Math.round(p.x), Math.round(p.y), 1, 1);
      }
      f.globalAlpha = 1;
      if (this.particles.length > 600) this.particles.splice(0, this.particles.length - 600);
    }

    drawFlights(f, t) {
      for (let i = this.flights.length - 1; i >= 0; i--) {
        const fl = this.flights[i];
        if (fl.t0 === null) fl.t0 = t;
        const p = (t - fl.t0) / fl.dur;
        if (p >= 1) {
          this.flights.splice(i, 1);
          const te = fl.to && this.entities.get(fl.to);
          if (te) te.mailUntil = t + 3;
          continue;
        }
        const lx = fl.x0 + (fl.x1 - fl.x0) * p;
        const ly = fl.y0 + (fl.y1 - fl.y0) * p;
        const y = ly - Math.sin(Math.PI * p) * fl.arc;
        f.fillStyle = 'rgba(20,14,8,0.18)';
        if (ly > 0) f.fillRect(Math.round(lx) - 2, Math.round(ly) + 12, 5, 1);
        S.drawEagle(f, Math.round(lx), Math.round(y), t, fl.x1 < fl.x0);
      }
      for (const e of this.entities.values()) {
        if (e.mailUntil > t && !e.leaving) S.draw(f, 'bubble_mail', Math.round(e.x) + 2, Math.round(e.y) - 23, {});
      }
    }

    // ------------------------------------------------ overlay (screen space)

    drawOverlay(c, t) {
      const { s, ox, oy, dpr } = this.view;
      const X = (x) => ox + x * s;
      const Y = (y) => oy + y * s;
      const u = Math.max(1, Math.round(s / 3));
      const css = s / dpr;
      const placed = [];
      this.hud = [];

      // Territory names.
      c.textAlign = 'center';
      c.textBaseline = 'top';
      const labelPx = Math.round((css >= 5 ? 20 : 16) * dpr);
      c.font = `${labelPx}px VT323${FB}`;
      c.lineJoin = 'round';
      for (const T of TERRITORIES) {
        const on = this.active.has(T.key);
        c.globalAlpha = on ? 1 : 0.62;
        c.lineWidth = Math.max(2, 3 * dpr);
        c.strokeStyle = 'rgba(244,232,198,0.9)';
        const ly = Y(T.cy + T.ry + 4);
        const tname = tr('terr.' + T.key);
        c.strokeText(tname, X(T.cx), ly);
        c.fillStyle = on ? '#2e1c0e' : '#4a3a28';
        c.fillText(tname, X(T.cx), ly);
      }
      c.globalAlpha = 1;

      // Hovered territory outline.
      if (this.hover && this.hover.type === 'territory') {
        const T = TERR_BY_KEY[this.hover.key];
        if (T) {
          c.save();
          c.setLineDash([4 * dpr, 4 * dpr]);
          c.strokeStyle = 'rgba(255,240,190,0.9)';
          c.lineWidth = 2 * dpr;
          c.beginPath();
          c.ellipse(X(T.cx), Y(T.cy - 3), (T.rx + 7) * s, (T.ry + 8) * s, 0, 0, Math.PI * 2);
          c.stroke();
          c.restore();
        }
      }

      // Banners with project names + status badge.
      const bannerPx = Math.round((css >= 5.5 ? 16 : 8) * dpr);
      for (const key of this.active) {
        const T = TERR_BY_KEY[key];
        if (!T) continue;
        const sessions = [];
        let top = 'idle';
        for (const a of this.agents.values()) {
          if (a.territory !== key || a.status === 'done') continue;
          if (a.kind === 'session') sessions.push(a);
          if ((STATUS[a.status] || STATUS.idle).rank > STATUS[top].rank) top = a.status;
        }
        if (!sessions.length) continue;
        sessions.sort((p, q) => p.startedAt - q.startedAt);
        let name = sessions.map((x) => x.project).join(' + ');
        if (name.length > 22) name = name.slice(0, 21) + '…';
        name = I18N.title(name); // elf: ✧ ornaments ✧
        const info = STATUS[top] || STATUS.idle;
        const r = this.drawBanner(c, X(T.cx), Y(T.cy - 25), name, { color: info.color, label: tr('banner.' + (STATUS[top] ? top : 'idle')) }, top === 'waiting', bannerPx, u, t, dpr);
        placed.push(r);
        // Lantern (context of the fullest bag here) on the right, model badge on the left.
        let bag = null;
        for (const x of sessions) if (x.usage && x.usage.contextPct != null && (!bag || x.usage.contextPct > bag.usage.contextPct)) bag = x;
        if (bag) {
          const lu = Math.max(u, Math.round(bannerPx / 8));
          const lr = this.drawLantern(c, r.x + r.w + 2 * u, r.y, bag.usage.contextPct, lu, t);
          this.hud.push({ ...lr, hit: { type: 'lantern', id: bag.id, key } });
          placed.push(lr);
        }
        const withModel = sessions.find((x) => modelInfo(x));
        if (withModel) {
          const br = this.drawModelBadge(c, r.x - 2 * u, r.y + u, modelInfo(withModel), u, dpr);
          this.hud.push({ ...br, hit: { type: 'model', id: withModel.id, key } });
          placed.push(br);
        }
      }

      // Speech bubbles.
      const bubblePx = Math.round((css >= 5 ? 18 : 16) * dpr);
      c.font = `${bubblePx}px VT323${FB}`;
      const maxLen = I18N.getLang() === 'ent' ? 44 : I18N.getLang() === 'ja' ? 22 : 30;
      const now = Date.now();
      const items = [];
      for (const e of this.entities.values()) {
        if (e.leaving || e.alpha < 0.6) continue;
        const a = e.agent;
        const hovered = this.hover && this.hover.type === 'agent' && this.hover.id === e.id;
        let text = null;
        let urgent = false;
        const ctx = a.usage && a.usage.contextPct;
        if (a.status === 'waiting') {
          text = '! ' + ((a.waiting && R(a.waiting.i, a.waiting.message)) || tr('bubble.waiting'));
          urgent = true;
        } else if (this.starved(a)) {
          text = tr('bubble.starved');
        } else if (a.kind === 'session' && ctx >= 85 && !hovered && Math.floor(now / 1000 + e.seed * 30) % 24 < 4) {
          text = tr('bubble.bagFull');
        } else if (hovered || (a.status !== 'idle' && a.lastAction && now - a.lastActionAt < (a.kind === 'session' ? 15000 : 9000))) {
          text = R(a.lastActionI, a.lastAction);
        }
        if (!text) continue;
        if (text.length > maxLen) text = text.slice(0, maxLen - 1) + '…';
        const prio = urgent ? 3 : hovered ? 2 : a.kind === 'session' ? 1 : 0;
        items.push({ e, text, urgent, prio });
      }
      items.sort((p, q) => q.prio - p.prio);
      for (const it of items) {
        const tw = c.measureText(it.text).width;
        const pad = 3 * u;
        const bw = Math.ceil(tw + pad * 2);
        const bh = Math.ceil(bubblePx * 0.8 + pad * 2);
        const cx = X(it.e.x);
        let by = Y(it.e.y - 17) - bh;
        let bx = Math.round(clamp(cx - bw / 2, 2, this.view.cw - bw - 2));
        let tries = 0;
        let moved = true;
        while (moved && tries < 8) {
          moved = false;
          for (const r of placed) {
            if (bx < r.x + r.w && bx + bw > r.x && by < r.y + r.h && by + bh > r.y) {
              by = r.y - bh - u;
              moved = true;
            }
          }
          tries++;
        }
        if (tries >= 8 && !it.urgent) continue;
        if (it.prio === 0 && Y(it.e.y - 17) - (by + bh) > bh * 2.5) continue;
        placed.push({ x: bx, y: by, w: bw, h: bh });
        this.drawBubble(c, bx, by, bw, bh, cx, Y(it.e.y - 16), it.text, it.urgent, u, pad, t);
      }
    }

    drawBanner(c, cx, bottom, text, info, urgent, fontPx, u, t, dpr) {
      c.font = `${fontPx}px "Press Start 2P"${FB}`;
      const tw = c.measureText(text).width;
      const padX = 4 * u;
      const h = Math.round(fontPx + 5 * u);
      const w = Math.round(tw + padX * 2);
      const x0 = Math.round(cx - w / 2);
      const y0 = Math.round(bottom - h - 8 * u);
      // Ribbon tails.
      c.fillStyle = '#2a140c';
      c.fillRect(x0 - 5 * u, y0 + 2 * u, 6 * u, h);
      c.fillRect(x0 + w - u, y0 + 2 * u, 6 * u, h);
      c.fillStyle = '#5e1c14';
      c.fillRect(x0 - 4 * u, y0 + 3 * u, 5 * u, h - 2 * u);
      c.fillRect(x0 + w - u, y0 + 3 * u, 5 * u, h - 2 * u);
      c.fillStyle = '#2a140c';
      c.fillRect(x0 - 5 * u, y0 + 2 * u + Math.round(h / 2) - u, 2 * u, 2 * u);
      c.fillRect(x0 + w + 3 * u, y0 + 2 * u + Math.round(h / 2) - u, 2 * u, 2 * u);
      // Body.
      const blink = urgent && Math.floor(t * 3) % 2 === 0;
      c.fillStyle = blink ? '#ffd23a' : '#2a140c';
      c.fillRect(x0 - u, y0 - u, w + 2 * u, h + 2 * u);
      c.fillStyle = '#8c2f24';
      c.fillRect(x0, y0, w, h);
      c.fillStyle = '#ad4a3c';
      c.fillRect(x0, y0, w, u);
      c.fillStyle = '#6a2219';
      c.fillRect(x0, y0 + h - u, w, u);
      c.fillStyle = '#f6dc8a';
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      c.fillText(text, cx, y0 + h / 2 + u * 0.5);
      // Status badge.
      const bp = Math.round(fontPx === 8 * dpr ? 14 * dpr : 16 * dpr);
      c.font = `${bp}px VT323${FB}`;
      const lw = c.measureText(info.label).width;
      const bw = Math.round(lw + 6 * u);
      const bh = Math.round(bp * 0.75 + 2 * u);
      const bx = Math.round(cx - bw / 2);
      const by = y0 + h + u;
      c.fillStyle = '#2a140c';
      c.fillRect(bx - u, by, bw + 2 * u, bh + u);
      c.fillStyle = info.color;
      c.fillRect(bx, by, bw, bh);
      c.fillStyle = '#fff8e6';
      c.fillText(info.label, cx, by + bh / 2 + u * 0.5);
      return { x: x0 - 5 * u, y: y0 - u, w: w + 10 * u, h: h + bh + 3 * u };
    }

    /** Pixel lantern (screen space). Full and bright when the context is nearly empty. Returns its box. */
    drawLantern(c, x, y, ctxPct, u, t) {
      const fill = clamp(1 - (Number(ctxPct) || 0) / 100, 0, 1);
      const w = 7 * u, h = 12 * u;
      x = Math.round(x);
      y = Math.round(y);
      // Halo, stronger when full, with a slight flicker.
      const flick = 0.85 + 0.15 * Math.sin(t * 9 + x);
      if (fill > 0.15) {
        c.fillStyle = `rgba(255,214,110,${0.22 * fill * flick})`;
        c.fillRect(x - 3 * u, y + u, w + 6 * u, h + 2 * u);
        c.fillStyle = `rgba(255,230,150,${0.25 * fill * flick})`;
        c.fillRect(x - u, y + 3 * u, w + 2 * u, h - 3 * u);
      }
      const ink = '#1d140c';
      // Ring + cap.
      c.fillStyle = ink;
      c.fillRect(x + 2 * u, y, 3 * u, u);
      c.fillRect(x + 2 * u, y, u, 2 * u);
      c.fillRect(x + 4 * u, y, u, 2 * u);
      c.fillRect(x, y + 2 * u, w, 2 * u);
      c.fillStyle = '#6a5a44';
      c.fillRect(x + u, y + 2 * u, w - 2 * u, u);
      // Glass.
      const gx = x + u, gy = y + 4 * u, gw = w - 2 * u, gh = 6 * u;
      c.fillStyle = ink;
      c.fillRect(x, gy, w, gh);
      c.fillStyle = '#2b2a35';
      c.fillRect(gx, gy, gw, gh);
      const lit = Math.round(gh * fill / u) * u;
      if (lit > 0) {
        c.fillStyle = fill > 0.6 ? '#ffe066' : fill > 0.3 ? '#ffb020' : '#d8641f';
        c.fillRect(gx, gy + gh - lit, gw, lit);
        c.fillStyle = `rgba(255,255,240,${0.5 * fill * flick})`;
        c.fillRect(gx + u, gy + gh - lit, u, Math.max(u, lit - u));
      }
      // Bars of the frame + base.
      c.fillStyle = ink;
      c.fillRect(x + 3 * u, gy, u, gh);
      c.fillRect(x, gy + gh, w, 2 * u);
      c.fillStyle = '#6a5a44';
      c.fillRect(x + u, gy + gh, w - 2 * u, u);
      return { x: x - u, y: y - u, w: w + 2 * u, h: h + 2 * u };
    }

    /** Small model badge (letter on a coloured tile), right edge at x. Returns its box. */
    drawModelBadge(c, xRight, y, info, u, dpr) {
      const px = Math.round(14 * dpr);
      c.font = `${px}px VT323${FB}`;
      const size = Math.round(Math.max(9 * u, px * 0.9));
      const x = Math.round(xRight - size);
      y = Math.round(y);
      c.fillStyle = '#1d140c';
      c.fillRect(x - u, y - u, size + 2 * u, size + 2 * u);
      c.fillStyle = info.color;
      c.fillRect(x, y, size, size);
      c.fillStyle = 'rgba(255,255,255,0.25)';
      c.fillRect(x, y, size, u);
      c.fillStyle = '#fff8e6';
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      c.fillText(info.letter, x + size / 2, y + size / 2 + u * 0.5);
      return { x: x - u, y: y - u, w: size + 2 * u, h: size + 2 * u };
    }

    drawBubble(c, x, y, w, h, tailX, tailY, text, urgent, u, pad, t) {
      const border = urgent ? (Math.floor(t * 3) % 2 ? '#d8321f' : '#ffb020') : '#3a2614';
      c.fillStyle = border;
      c.fillRect(x - u, y, w + 2 * u, h);
      c.fillRect(x, y - u, w, h + 2 * u);
      c.fillStyle = urgent ? '#fff1d6' : '#fbf3dc';
      c.fillRect(x, y, w, h);
      // Tail.
      const tx = Math.round(clamp(tailX, x + 3 * u, x + w - 4 * u));
      c.fillStyle = border;
      c.fillRect(tx - u, y + h, 3 * u, u);
      c.fillRect(tx, y + h + u, u, Math.max(u, Math.min(4 * u, tailY - (y + h + u))));
      c.fillStyle = urgent ? '#8c1d10' : '#2e1c0e';
      c.textAlign = 'left';
      c.textBaseline = 'middle';
      c.fillText(text, x + pad, y + h / 2 + u * 0.5);
    }

    // ------------------------------------------------ picking

    toWorld(clientX, clientY) {
      const rect = this.canvas.getBoundingClientRect();
      const { s, ox, oy, dpr } = this.view;
      return { x: ((clientX - rect.left) * dpr - ox) / s, y: ((clientY - rect.top) * dpr - oy) / s };
    }

    pick(clientX, clientY) {
      const rect = this.canvas.getBoundingClientRect();
      const sx = (clientX - rect.left) * this.view.dpr, sy = (clientY - rect.top) * this.view.dpr;
      for (const b of this.hud) {
        if (sx >= b.x && sx <= b.x + b.w && sy >= b.y && sy <= b.y + b.h) return b.hit;
      }
      const { x, y } = this.toWorld(clientX, clientY);
      let best = null;
      let bd = Infinity;
      for (const e of this.entities.values()) {
        if (e.leaving) continue;
        const pts = [[e.x, e.y]];
        if (e.helperPos) pts.push([e.helperPos.x, e.helperPos.y]);
        for (const [px, py] of pts) {
          if (x >= px - 6 && x <= px + 6 && y >= py - 16 && y <= py + 2) {
            const d = Math.abs(x - px) + Math.abs(y - (py - 6));
            if (d < bd) {
              bd = d;
              best = e;
            }
          }
        }
      }
      if (best) return { type: 'agent', id: best.id };
      for (const T of TERRITORIES) {
        const dx = (x - T.cx) / (T.rx + 7), dy = (y - (T.cy - 3)) / (T.ry + 8);
        if (dx * dx + dy * dy <= 1) return { type: 'territory', key: T.key };
      }
      return null;
    }

    onMove(ev) {
      const hit = this.pick(ev.clientX, ev.clientY);
      this.hover = hit;
      this.canvas.style.cursor = hit ? 'pointer' : 'default';
      if (this.opts.onHover) this.opts.onHover(hit, ev.clientX, ev.clientY);
    }
  }

  window.LOTRScene = { Scene, STATUS, roleAvatar, workFor, modelInfo };
})();
