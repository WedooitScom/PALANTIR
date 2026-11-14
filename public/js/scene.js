/* Scene: characters, effects, render loop and hit-testing on top of the map.
 * World is rendered at W x H "map pixels" into an offscreen canvas, then scaled
 * by an integer factor onto the visible canvas (image smoothing off).
 * Text (banners, labels, speech bubbles) is drawn in screen space for crispness.
 */
(function () {
  'use strict';

  const M = window.LOTRMap;
  const S = window.Sprites;
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

      this.resize();
      if (window.ResizeObserver) new ResizeObserver(() => this.resize()).observe(canvas.parentElement);
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
      const s = Math.max(1, Math.floor(Math.min(cw / W, ch / H)));
      this.view = { s, dpr, cw, ch, ox: Math.floor((cw - W * s) / 2), oy: Math.floor((ch - H * s) / 2) };
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
      const t = ts / 1000;
      if (this.startT === null) this.startT = t;
      const dt = Math.min(0.05, Math.max(0, t - (this.lastT || t)));
      this.lastT = t;
      if (!this.warm && t - this.startT > 0.6) this.warm = true;
      try {
        this.render(t, dt);
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
        mailUntil: 0, helperWork: null, helperAlpha: 0, helperPos: null,
      };
      this.entities.set(a.id, e);
      return e;
    }

    moveEntity(e, t, dt) {
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
      const amt = this.forceNight ? 0.38 : this.nightEnabled ? M.nightAmount(new Date()) : 0;
      M.drawNight(f, w, amt, t, lights);
      this.drawShadow(f, t);

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
      c.font = `${labelPx}px VT323, monospace`;
      c.lineJoin = 'round';
      for (const T of TERRITORIES) {
        const on = this.active.has(T.key);
        c.globalAlpha = on ? 1 : 0.62;
        c.lineWidth = Math.max(2, 3 * dpr);
        c.strokeStyle = 'rgba(244,232,198,0.9)';
        const ly = Y(T.cy + T.ry + 4);
        c.strokeText(T.name, X(T.cx), ly);
        c.fillStyle = on ? '#2e1c0e' : '#4a3a28';
        c.fillText(T.name, X(T.cx), ly);
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
        const r = this.drawBanner(c, X(T.cx), Y(T.cy - 25), name, STATUS[top] || STATUS.idle, top === 'waiting', bannerPx, u, t, dpr);
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
      c.font = `${bubblePx}px VT323, monospace`;
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
          text = '! ' + ((a.waiting && a.waiting.message) || 'Attend ta réponse');
          urgent = true;
        } else if (this.starved(a)) {
          text = 'Plus de lembas…';
        } else if (a.kind === 'session' && ctx >= 85 && !hovered && Math.floor(now / 1000 + e.seed * 30) % 24 < 4) {
          text = 'Mon sac est plein !';
        } else if (hovered || (a.status !== 'idle' && a.lastAction && now - a.lastActionAt < (a.kind === 'session' ? 15000 : 9000))) {
          text = a.lastAction || '';
        }
        if (!text) continue;
        if (text.length > 30) text = text.slice(0, 29) + '…';
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
      c.font = `${fontPx}px "Press Start 2P", monospace`;
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
      c.font = `${bp}px VT323, monospace`;
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
      c.font = `${px}px VT323, monospace`;
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
