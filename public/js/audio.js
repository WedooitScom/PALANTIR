/* Audio: one shared AudioContext with three buses (master <- music (+ ducking) and sfx).
 * - an original 8-bit Celtic pastoral tune synthesised with WebAudio (no audio files),
 *   or "ta musique": a local file chosen by the user, played through the same music bus;
 * - short original chiptune sound effects for key moments, and rare ambient sounds;
 * - the alert beep. */
(function () {
  'use strict';

  // ------------------------------------------------------------ shared context

  let ctx = null;
  let hadGesture = false;
  const stateListeners = [];
  function getCtx() {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      try {
        ctx = new AC();
      } catch {
        ctx = null;
        return null;
      }
      ctx.onstatechange = onState;
    }
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    return ctx;
  }

  // Browsers keep the context suspended until a user gesture: retry on each
  // pointerdown/keydown until it actually runs (no `once`).
  function unlock() {
    hadGesture = true;
    const c = getCtx();
    if (c && c.state === 'running') removeUnlock();
    if (music.wanted && music.source === 'custom' && custom.el && custom.el.paused) beginMusic();
  }
  function removeUnlock() {
    document.removeEventListener('pointerdown', unlock, true);
    document.removeEventListener('keydown', unlock, true);
  }
  document.addEventListener('pointerdown', unlock, true);
  document.addEventListener('keydown', unlock, true);

  function onState() {
    if (!ctx) return;
    if (ctx.state === 'running') {
      removeUnlock();
      if (music.wanted) beginMusic();
    }
    for (const fn of stateListeners) {
      try {
        fn(ctx.state);
      } catch {
        /* ignore */
      }
    }
  }

  /** Called by the macOS app when the window becomes key, and when the page becomes visible. */
  function resume(reason) {
    const c = getCtx();
    if (!c) return 'none';
    if (c.state !== 'running') {
      c.resume().then(() => {
        if (music.wanted) beginMusic();
      }).catch(() => {});
    }
    lastResume = { reason: String(reason || ''), state: c.state, at: Date.now() };
    return c.state;
  }
  let lastResume = null;
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) resume('visible');
  });

  // ------------------------------------------------------------ buses
  // destination <- master (general volume) <- duck <- music (music volume)
  //                                        <- sfx (effects volume) <- ambient (very low)

  const levels = { volume: 0.8, music: 0.8, sfx: 0.8 };
  // Perceptual curve; the default slider position (0.8) gives a gain of 1.
  const curve = (v) => {
    const x = Math.min(1, Math.max(0, Number(v) || 0));
    return x * x * 1.5625;
  };
  let bus = null;
  let muted = false; // global mute (🔊 button): the master bus goes to 0
  const masterGain = () => (muted ? 0 : curve(levels.volume));
  function getBus() {
    const c = getCtx();
    if (!c) return null;
    if (!bus) {
      const master = c.createGain();
      master.gain.value = masterGain();
      master.connect(c.destination);
      const duck = c.createGain();
      duck.gain.value = 1;
      duck.connect(master);
      const musicBus = c.createGain();
      musicBus.gain.value = curve(levels.music);
      musicBus.connect(duck);
      const sfx = c.createGain();
      sfx.gain.value = curve(levels.sfx);
      sfx.connect(master);
      const ambient = c.createGain();
      ambient.gain.value = 0.35;
      ambient.connect(sfx);
      bus = { master, duck, music: musicBus, sfx, ambient };
    }
    return bus;
  }

  function setLevels(v) {
    for (const k of ['volume', 'music', 'sfx']) {
      if (v && v[k] != null && Number.isFinite(Number(v[k]))) levels[k] = Math.min(1, Math.max(0, Number(v[k])));
    }
    if (!bus || !ctx) return;
    const t = ctx.currentTime;
    bus.master.gain.setTargetAtTime(masterGain(), t, 0.05);
    bus.music.gain.setTargetAtTime(curve(levels.music), t, 0.05);
    bus.sfx.gain.setTargetAtTime(curve(levels.sfx), t, 0.05);
  }

  function setMuted(on) {
    muted = !!on;
    if (!bus || !ctx) return;
    bus.master.gain.setTargetAtTime(masterGain(), ctx.currentTime, 0.03);
  }

  // Music dips briefly under important sound effects.
  let ducks = 0;
  function duck(secs) {
    const b = getBus();
    if (!b) return;
    const t = ctx.currentTime;
    const g = b.duck.gain;
    g.cancelScheduledValues(t);
    g.setValueAtTime(g.value, t);
    g.linearRampToValueAtTime(0.35, t + 0.08);
    g.setValueAtTime(0.35, t + 0.08 + secs);
    g.linearRampToValueAtTime(1, t + 0.8 + secs);
    ducks++;
  }

  // ------------------------------------------------------------ alert beep

  let beeps = 0;
  function playBeep(c) {
    const out = getBus().sfx;
    const t0 = c.currentTime + 0.01;
    [660, 880].forEach((f, i) => {
      const o = c.createOscillator();
      const g = c.createGain();
      o.type = 'square';
      o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, t0 + i * 0.14);
      g.gain.exponentialRampToValueAtTime(0.04, t0 + i * 0.14 + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + i * 0.14 + 0.12);
      o.connect(g).connect(out);
      o.start(t0 + i * 0.14);
      o.stop(t0 + i * 0.14 + 0.13);
    });
    beeps++;
  }
  function beep() {
    if (!sfxState.enabled) return;
    const c = getCtx();
    if (!c) return;
    try {
      if (c.state === 'running') return playBeep(c);
      // Suspended: play only if the resume succeeds right away (WebView, or a
      // page that already had a gesture), never as a late burst on first click.
      const asked = performance.now();
      c.resume().then(() => {
        if (performance.now() - asked < 400) playBeep(c);
      }).catch(() => {});
    } catch {
      /* ignore */
    }
  }

  // ------------------------------------------------------------ the tune
  // Original slow jig, D major, 6/8 at 76 dotted-quarters/min (eighth-note grid).
  // Form A A' B A, 8 bars each: 32 bars ≈ 50 s. B borrows the mixolydian C natural.
  // Lead: tin-whistle-like narrow pulse + vibrato + grace notes; harp arpeggios;
  // low drone on D and A. During an alert the "shadow" mode takes over.

  const DOTTED_BPM = 76;
  const EIGHTH = 60 / DOTTED_BPM / 3;
  const STEPS_PER_BAR = 6;
  const BARS_PER_SECTION = 8;
  const R = null; // rest

  // Each note: [midi, length in eighths, optional grace-note midi]. Bars sum to 6.
  const A = [
    [[66, 2], [69, 1], [74, 2], [73, 1]], //           D
    [[71, 3, 73], [67, 2], [71, 1]], //                 G
    [[69, 2], [66, 1], [62, 2], [66, 1]], //           D
    [[64, 3, 66], [69, 2], [73, 1]], //                 A
    [[74, 2], [73, 1], [71, 2], [69, 1]], //           D
    [[67, 2], [71, 1], [74, 3, 76]], //                 G
    [[76, 2], [73, 1], [69, 2], [64, 1]], //           A
    [[62, 5, 64], [R, 1]], //                           D
  ];
  // A': same tune, last bar climbs into B.
  const A2 = A.slice(0, 7).concat([[[62, 3], [66, 1], [69, 2]]]);
  const B = [
    [[76, 2], [79, 1], [76, 2], [72, 1]], //           C (mixolydian)
    [[74, 3, 76], [71, 2], [67, 1]], //                 G
    [[69, 2], [74, 1], [78, 2], [76, 1]], //           D
    [[74, 4, 76], [72, 1], [71, 1]], //                 D (C natural passing)
    [[72, 2], [76, 1], [79, 3, 81]], //                 C
    [[79, 2], [74, 1], [71, 2], [74, 1]], //           G
    [[72, 2], [71, 1], [69, 2], [67, 1]], //           Am
    [[66, 2], [64, 1], [62, 3, 64]], //                 D
  ];
  // Harp chord per bar: [root midi (octave 3), minor?]
  const D_ = [50, false], G_ = [55, false], A_ = [57, false], C_ = [48, false], Am = [57, true];
  const CH_A = [D_, G_, D_, A_, D_, G_, A_, D_];
  const CH_B = [C_, G_, D_, D_, C_, G_, Am, D_];

  const FORM = [['A', A, CH_A], ['A′', A2, CH_A], ['B', B, CH_B], ['A', A, CH_A]];
  const MELODY_AT = new Map();
  const CHORDS = [];
  FORM.forEach(([, bars, chords], sec) => {
    bars.forEach((bar, b) => {
      const barIdx = sec * BARS_PER_SECTION + b;
      CHORDS[barIdx] = chords[b];
      let s = barIdx * STEPS_PER_BAR;
      for (const [m, len, grace] of bar) {
        if (m != null) MELODY_AT.set(s, { midi: m, len, grace });
        s += len;
      }
    });
  });
  const TOTAL_STEPS = CHORDS.length * STEPS_PER_BAR;
  // Rolling 6/8 harp figure: root, fifth, octave, tenth, octave, fifth.
  const HARP = [0, 7, 12, 16, 12, 7];

  const hz = (m) => 440 * Math.pow(2, (m - 69) / 12);

  // ------------------------------------------------------------ music engine

  const MASTER = 0.05;
  const DRONE_LOW = 38; // D2
  const DRONE_HIGH = 45; // A2 (glides to G#2, a discreet tritone, in shadow mode)
  const music = {
    wanted: false,
    source: 'generated', // 'generated' | 'custom' (falls back to generated when the file fails)
    playing: false, // generated tune running
    tension: false, // wanted shadow mode (set by the app)
    shadow: false, // shadow mode actually applied (switches on bar lines)
    timer: null,
    step: 0,
    nextTime: 0,
    notes: 0,
    loops: 0,
    nodes: null,
    stopTimer: null,
  };
  let noiseBuf = null;
  let pulseWave = null;

  function buildGraph(c) {
    const master = c.createGain();
    master.gain.value = 0;
    master.connect(getBus().music);

    // Lead "whistle": narrow pulse (25 %) through a lowpass, small room echo.
    if (!pulseWave) {
      const N = 24;
      const re = new Float32Array(N);
      const im = new Float32Array(N);
      for (let n = 1; n < N; n++) re[n] = (2 / (n * Math.PI)) * Math.sin(n * Math.PI * 0.25);
      pulseWave = c.createPeriodicWave(re, im);
    }
    const lead = c.createGain();
    lead.gain.value = 0.5;
    const lp = c.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 2400;
    const echo = c.createDelay(2);
    echo.delayTime.value = EIGHTH * 2;
    const fb = c.createGain();
    fb.gain.value = 0.2;
    const wet = c.createGain();
    wet.gain.value = 0.28;
    lead.connect(lp).connect(master);
    lp.connect(echo).connect(fb).connect(echo);
    echo.connect(wet).connect(master);

    // Vibrato: one 5 Hz LFO feeding every lead oscillator's detune (±12 cents).
    const lfo = c.createOscillator();
    lfo.frequency.value = 5;
    const lfoDepth = c.createGain();
    lfoDepth.gain.value = 12;
    lfo.connect(lfoDepth);
    lfo.start();

    const harp = c.createGain();
    harp.gain.value = 0.45;
    harp.connect(master);

    const perc = c.createGain();
    perc.gain.value = 0.15;
    perc.connect(master);

    const drum = c.createGain();
    drum.gain.value = 0.6;
    drum.connect(master);

    // Drone: D2 + A2, sawtooth softened by a lowpass.
    const droneGain = c.createGain();
    droneGain.gain.value = 0.1;
    const dlp = c.createBiquadFilter();
    dlp.type = 'lowpass';
    dlp.frequency.value = 600;
    droneGain.connect(dlp).connect(master);
    const drones = [DRONE_LOW, DRONE_HIGH].map((m, i) => {
      const o = c.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = hz(m);
      o.detune.value = i ? 4 : -3;
      o.connect(droneGain);
      o.start();
      return o;
    });

    if (!noiseBuf) {
      noiseBuf = c.createBuffer(1, Math.floor(c.sampleRate * 0.25), c.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    return { master, lead, lfo, lfoDepth, harp, perc, drum, droneGain, dlp, drones };
  }

  function whistle(freq, t, dur, peak) {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.setPeriodicWave(pulseWave);
    o.frequency.value = freq;
    music.nodes.lfoDepth.connect(o.detune);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + 0.025);
    g.gain.setValueAtTime(peak * 0.85, t + Math.max(0.03, dur - 0.05));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(music.nodes.lead);
    o.start(t);
    o.stop(t + dur + 0.02);
    o.onended = () => {
      try {
        music.nodes && music.nodes.lfoDepth.disconnect(o.detune);
      } catch {
        /* already gone */
      }
    };
    music.notes++;
  }

  function pluck(freq, t, peak) {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'triangle';
    o.frequency.value = freq;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.9);
    o.connect(g).connect(music.nodes.harp);
    o.start(t);
    o.stop(t + 0.92);
    music.notes++;
  }

  // Bodhrán-ish brush: lowpassed noise, very soft.
  function brush(t, peak) {
    const s = ctx.createBufferSource();
    s.buffer = noiseBuf;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = 900;
    const g = ctx.createGain();
    g.gain.setValueAtTime(peak, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.08);
    s.connect(f).connect(g).connect(music.nodes.perc);
    s.start(t);
    s.stop(t + 0.1);
    music.notes++;
  }

  function lowDrum(t, peak) {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(110, t);
    o.frequency.exponentialRampToValueAtTime(45, t + 0.3);
    g.gain.setValueAtTime(peak, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.6);
    o.connect(g).connect(music.nodes.drum);
    o.start(t);
    o.stop(t + 0.62);
    music.notes++;
  }

  function ramp(param, value, t, secs) {
    param.cancelScheduledValues(t);
    param.setValueAtTime(param.value, t);
    param.linearRampToValueAtTime(value, t + secs);
  }

  // Enter/leave the shadow mode on a bar line, with slow transitions.
  function applyShadow(on, t) {
    const n = music.nodes;
    music.shadow = on;
    const secs = on ? 3 : 5; // back to calm more gently
    ramp(n.lead.gain, on ? 0 : 0.5, t, secs);
    ramp(n.drones[1].frequency, hz(on ? DRONE_HIGH - 1 : DRONE_HIGH), t, secs);
    ramp(n.dlp.frequency, on ? 380 : 600, t, secs);
    ramp(n.droneGain.gain, on ? 0.14 : 0.1, t, secs);
  }

  function scheduleStep(step, t) {
    const bar = Math.floor(step / STEPS_PER_BAR);
    const inBar = step % STEPS_PER_BAR;
    if (inBar === 0 && music.shadow !== music.tension) applyShadow(music.tension, t);

    // Lead (silenced by its gain in shadow mode, not skipped, so it can fade).
    const m = MELODY_AT.get(step);
    if (m && (!music.shadow || music.nodes.lead.gain.value > 0.01)) {
      let t0 = t;
      let dur = m.len * EIGHTH * 0.95;
      if (m.grace) {
        whistle(hz(m.grace), t0, 0.06, 0.35);
        t0 += 0.05;
        dur -= 0.05;
      }
      whistle(hz(m.midi), t0, dur, 0.5);
    }

    // Harp: rolling arpeggio; in shadow mode the chord turns minor.
    const [root, minor] = CHORDS[bar];
    let iv = HARP[inBar];
    if (iv === 16 && (minor || music.shadow)) iv = 15;
    pluck(hz(root + iv), t, inBar === 0 ? 0.7 : 0.45);

    // Calm: a barely-there brush on each dotted beat. Shadow: slow low drum.
    if (music.shadow) {
      if (inBar === 0) lowDrum(t, 0.9);
      if (inBar === 3 && bar % 2 === 1) lowDrum(t, 0.5);
    } else if (inBar === 0 || inBar === 3) {
      brush(t, inBar === 0 ? 0.5 : 0.3);
    }
  }

  function scheduler() {
    if (!music.playing || !ctx) return;
    // Hidden pages get their timers throttled to ~1 s: plan further ahead.
    const ahead = document.hidden ? 1.5 : 0.15;
    while (music.nextTime < ctx.currentTime + ahead) {
      scheduleStep(music.step, music.nextTime);
      music.nextTime += EIGHTH;
      music.step++;
      if (music.step >= TOTAL_STEPS) {
        music.step = 0;
        music.loops++;
      }
    }
  }

  function beginGenerated() {
    const c = getCtx();
    if (!c || c.state !== 'running') return; // resumes later via onstatechange
    if (music.stopTimer) {
      clearTimeout(music.stopTimer);
      music.stopTimer = null;
    }
    if (!music.nodes) {
      music.nodes = buildGraph(c);
      music.shadow = false;
    }
    const now = c.currentTime;
    ramp(music.nodes.master.gain, MASTER, now, 2.5);
    if (!music.playing) {
      music.playing = true;
      music.step = 0;
      music.nextTime = now + 0.1;
      music.timer = setInterval(scheduler, 25);
      scheduler();
    }
  }

  function stopGenerated() {
    if (!music.playing || !ctx || !music.nodes) return;
    ramp(music.nodes.master.gain, 0, ctx.currentTime, 1.5);
    if (music.stopTimer) clearTimeout(music.stopTimer);
    music.stopTimer = setTimeout(() => {
      music.stopTimer = null;
      if (music.wanted && music.source === 'generated') return;
      clearInterval(music.timer);
      music.timer = null;
      music.playing = false;
      const nodes = music.nodes;
      music.nodes = null;
      if (!nodes) return;
      for (const o of nodes.drones) o.stop();
      nodes.lfo.stop();
      nodes.master.disconnect();
    }, 1700);
  }

  // ------------------------------------------------------------ "ta musique"
  // A local file (blob: URL in a browser, /user-music from the macOS app) through the music bus:
  // same volume, fades, ducking, quieter in shadow mode, looped.

  const CUSTOM_LEVEL = 0.2; // a mastered track is far louder than the synthesised tune
  const CUSTOM_SHADOW = 0.4;
  const custom = { url: null, name: null, revoke: false, el: null, gain: null, error: null, stopTimer: null };

  function customTarget() {
    return CUSTOM_LEVEL * (music.tension ? CUSTOM_SHADOW : 1);
  }

  function dropCustomElement() {
    if (custom.stopTimer) {
      clearTimeout(custom.stopTimer);
      custom.stopTimer = null;
    }
    if (custom.el) {
      try {
        custom.el.pause();
        custom.el.removeAttribute('src');
        custom.el.load();
      } catch {
        /* ignore */
      }
    }
    if (custom.gain) {
      try {
        custom.gain.disconnect();
      } catch {
        /* ignore */
      }
    }
    custom.el = null;
    custom.gain = null;
  }

  function beginCustom() {
    const c = getCtx();
    if (!c || c.state !== 'running' || !custom.url) return;
    if (custom.stopTimer) {
      clearTimeout(custom.stopTimer);
      custom.stopTimer = null;
    }
    if (!custom.el) {
      const el = new Audio();
      el.loop = true;
      el.preload = 'auto';
      el.src = custom.url;
      el.addEventListener('error', () => {
        if (custom.el !== el) return; // element being dropped
        custom.error = (el.error && el.error.code) || 'error';
        fallBackToGenerated();
      });
      const gain = c.createGain();
      gain.gain.value = 0;
      c.createMediaElementSource(el).connect(gain).connect(getBus().music);
      custom.el = el;
      custom.gain = gain;
    }
    custom.error = null;
    ramp(custom.gain.gain, customTarget(), c.currentTime, 2.5);
    if (custom.el.paused) {
      custom.el.play().catch((e) => {
        // Browser without a gesture yet: unlock() retries on the next click.
        custom.error = (e && e.name) || 'play';
      });
    }
  }

  function stopCustom(drop) {
    if (!custom.el || !ctx) {
      if (drop) dropCustomElement();
      return;
    }
    ramp(custom.gain.gain, 0, ctx.currentTime, 1.5);
    if (custom.stopTimer) clearTimeout(custom.stopTimer);
    const el = custom.el;
    custom.stopTimer = setTimeout(() => {
      custom.stopTimer = null;
      if (drop) dropCustomElement();
      else if (!(music.wanted && music.source === 'custom')) el.pause();
    }, 1600);
  }

  let onCustomError = null;
  function fallBackToGenerated() {
    const name = custom.name;
    stopCustom(true);
    music.source = 'generated';
    if (music.wanted) beginGenerated();
    if (onCustomError) onCustomError(name, custom.error);
  }

  /** url = null: back to the generated tune. revoke: the url is a blob: URL owned by this module. */
  function setSource(src) {
    const url = src && src.url ? String(src.url) : null;
    if (url === custom.url && (url ? music.source === 'custom' : music.source === 'generated')) return;
    const oldUrl = custom.url;
    const oldRevoke = custom.revoke;
    stopCustom(true);
    if (oldUrl && oldRevoke && oldUrl !== url) {
      setTimeout(() => URL.revokeObjectURL(oldUrl), 2000);
    }
    custom.url = url;
    custom.name = url ? String((src && src.name) || '') : null;
    custom.revoke = !!(src && src.revoke);
    custom.error = null;
    music.source = url ? 'custom' : 'generated';
    if (!music.wanted) return;
    if (music.source === 'custom') {
      stopGenerated();
      beginCustom();
    } else {
      beginGenerated();
    }
  }

  // ------------------------------------------------------------ music on / off

  function beginMusic() {
    if (music.source === 'custom' && custom.url) {
      stopGenerated();
      beginCustom();
    } else {
      beginGenerated();
    }
  }

  function startMusic() {
    music.wanted = true;
    beginMusic();
  }

  function stopMusic() {
    music.wanted = false;
    stopGenerated();
    stopCustom(false);
  }

  function setTension(on) {
    on = !!on;
    if (on === music.tension) return;
    music.tension = on;
    if (custom.gain && ctx && music.wanted && music.source === 'custom') ramp(custom.gain.gain, customTarget(), ctx.currentTime, on ? 3 : 5);
  }

  // ------------------------------------------------------------ sound effects
  // Original chiptune effects, 0.1 to 1.2 s, mixed under the music on their own bus.
  // Anti-spam: at most one effect every 1.5 s (except the alert), the anvil at most every 8 s
  // for the whole map and only by chance. Never queued: a dropped effect is simply not played.

  const SFX_GAP_MS = 1500;
  const ANVIL_GAP_MS = 8000;
  const ANVIL_CHANCE = 0.35;
  const sfxState = { enabled: true, last: -Infinity, lastAnvil: -Infinity, lastName: null, counts: {}, dropped: {} };
  let sfxNoise = null;
  let sfxPulse = null;

  function noiseBuffer(c) {
    if (!sfxNoise) {
      sfxNoise = c.createBuffer(1, Math.floor(c.sampleRate * 1.5), c.sampleRate);
      const d = sfxNoise.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    return sfxNoise;
  }
  function pulse(c) {
    if (!sfxPulse) {
      const N = 24;
      const re = new Float32Array(N);
      const im = new Float32Array(N);
      for (let n = 1; n < N; n++) re[n] = (2 / (n * Math.PI)) * Math.sin(n * Math.PI * 0.25);
      sfxPulse = c.createPeriodicWave(re, im);
    }
    return sfxPulse;
  }

  /** One enveloped oscillator. o: { f, f2 (glide target), glide (s), type|'pulse', t, dur, peak, attack, lp, out } */
  function tone(c, o) {
    const osc = c.createOscillator();
    if (o.type === 'pulse') osc.setPeriodicWave(pulse(c));
    else osc.type = o.type || 'square';
    const t = o.t;
    const attack = o.attack || 0.008;
    osc.frequency.setValueAtTime(o.f0 || o.f, t);
    if (o.f0) osc.frequency.exponentialRampToValueAtTime(o.f, t + (o.scoop || 0.04));
    if (o.f2) osc.frequency.exponentialRampToValueAtTime(o.f2, t + (o.glide || o.dur));
    if (o.f3) osc.frequency.exponentialRampToValueAtTime(o.f3, t + o.dur);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(o.peak, t + attack);
    if (o.hold) g.gain.setValueAtTime(o.peak * 0.8, t + o.hold);
    g.gain.exponentialRampToValueAtTime(0.0001, t + o.dur);
    let node = osc.connect(g);
    if (o.lp) {
      const f = c.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = o.lp;
      node = node.connect(f);
    }
    node.connect(o.out);
    osc.start(t);
    osc.stop(t + o.dur + 0.03);
    return osc;
  }

  /** Filtered noise burst. o: { t, dur, peak, filter, freq, freq2, q, attack, out } */
  function noise(c, o) {
    const src = c.createBufferSource();
    src.buffer = noiseBuffer(c);
    src.loop = true;
    const f = c.createBiquadFilter();
    f.type = o.filter || 'bandpass';
    f.frequency.setValueAtTime(o.freq, o.t);
    if (o.freq2) f.frequency.exponentialRampToValueAtTime(o.freq2, o.t + (o.sweep || o.dur));
    if (o.freq3) f.frequency.exponentialRampToValueAtTime(o.freq3, o.t + o.dur);
    if (o.q) f.Q.value = o.q;
    const g = c.createGain();
    const attack = o.attack || 0.004;
    g.gain.setValueAtTime(0.0001, o.t);
    g.gain.exponentialRampToValueAtTime(o.peak, o.t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, o.t + o.dur);
    src.connect(f).connect(g).connect(o.out);
    src.start(o.t, Math.random() * 1.2);
    src.stop(o.t + o.dur + 0.03);
  }

  /** Small struck bell: inharmonic partials with their own decays. */
  function bell(c, out, t, f, peak) {
    [[1, 1, 1.1], [2.76, 0.45, 0.6], [5.4, 0.2, 0.3], [8.9, 0.08, 0.15]].forEach(([mul, g, d]) => {
      tone(c, { type: 'sine', f: f * mul, t, dur: d, peak: peak * g, attack: 0.003, out });
    });
  }

  const SFX = {
    // Nouvelle session: the inn's little bell, two strikes.
    inn: { dur: 1.2, duck: true, fn(c, t, out) {
      bell(c, out, t, 1318.5, 0.045);
      bell(c, out, t + 0.22, 1318.5, 0.03);
    } },
    // Sous-agent en mission: short horn call, filtered square, three rising notes.
    horn: { dur: 0.85, duck: true, fn(c, t, out) {
      [[62, 0, 0.17], [69, 0.18, 0.17], [74, 0.36, 0.45]].forEach(([m, dt, d]) => {
        const f = hz(m);
        tone(c, { type: 'square', f0: f * 0.97, f, t: t + dt, dur: d, peak: 0.03, attack: 0.03, hold: d * 0.6, lp: 1000, out });
        tone(c, { type: 'triangle', f: f / 2, t: t + dt, dur: d, peak: 0.02, attack: 0.03, out });
      });
    } },
    // Edit / Write: an anvil "ting".
    anvil: { dur: 0.5, fn(c, t, out) {
      tone(c, { type: 'sine', f: 2349, t, dur: 0.45, peak: 0.028, attack: 0.002, out });
      tone(c, { type: 'sine', f: 3730, t, dur: 0.28, peak: 0.012, attack: 0.002, out });
      tone(c, { type: 'sine', f: 5612, t, dur: 0.12, peak: 0.006, attack: 0.002, out });
      noise(c, { t, dur: 0.03, peak: 0.02, filter: 'highpass', freq: 4000, out });
    } },
    // SendMessage: a stylised eagle cry (high glissando up then down), with a shorter echo.
    eagle: { dur: 0.95, fn(c, t, out) {
      tone(c, { type: 'triangle', f: 1500, f2: 2700, glide: 0.12, f3: 1700, t, dur: 0.5, peak: 0.024, attack: 0.02, out });
      tone(c, { type: 'triangle', f: 1600, f2: 2400, glide: 0.08, f3: 1500, t: t + 0.55, dur: 0.32, peak: 0.014, attack: 0.02, out });
    } },
    // Agent done: little 4-note fanfare (pulse lead + triangle under the last note).
    fanfare: { dur: 0.85, duck: true, fn(c, t, out) {
      [[74, 0, 0.1], [78, 0.11, 0.1], [81, 0.22, 0.1], [86, 0.33, 0.42]].forEach(([m, dt, d]) => {
        tone(c, { type: 'pulse', f: hz(m), t: t + dt, dur: d, peak: 0.028, attack: 0.006, hold: d * 0.7, lp: 3200, out });
      });
      tone(c, { type: 'triangle', f: hz(69), t: t + 0.33, dur: 0.45, peak: 0.022, out });
      tone(c, { type: 'triangle', f: hz(62), t: t + 0.33, dur: 0.45, peak: 0.022, out });
    } },
    // Agent waiting: beacon call, the classic two-note beep followed by a low answer and a thump.
    beacon: { dur: 0.95, duck: true, alert: true, fn(c, t, out) {
      tone(c, { type: 'square', f: 660, t, dur: 0.13, peak: 0.04, attack: 0.01, lp: 2200, out });
      tone(c, { type: 'square', f: 880, t: t + 0.14, dur: 0.13, peak: 0.04, attack: 0.01, lp: 2200, out });
      tone(c, { type: 'square', f: hz(69), t: t + 0.34, dur: 0.5, peak: 0.035, attack: 0.02, hold: 0.3, lp: 1400, out });
      tone(c, { type: 'triangle', f: hz(57), t: t + 0.34, dur: 0.55, peak: 0.03, attack: 0.02, out });
      tone(c, { type: 'sine', f: 110, f2: 50, t: t + 0.34, dur: 0.4, peak: 0.08, attack: 0.004, out });
    } },
    // Usage threshold (80 / 95 %): two low drum hits.
    drum: { dur: 1, duck: true, fn(c, t, out) {
      [[0, 0.12], [0.34, 0.08]].forEach(([dt, p]) => {
        tone(c, { type: 'sine', f: 95, f2: 42, glide: 0.35, t: t + dt, dur: 0.6, peak: p, attack: 0.004, out });
        noise(c, { t: t + dt, dur: 0.12, peak: p * 0.4, filter: 'lowpass', freq: 320, out });
      });
    } },
    // Limits reset: an ascending sunrise phrase.
    sunrise: { dur: 1.2, duck: true, fn(c, t, out) {
      [74, 76, 78, 81, 83, 86].forEach((m, i) => {
        tone(c, { type: 'triangle', f: hz(m), t: t + i * 0.11, dur: i === 5 ? 0.6 : 0.4, peak: 0.026, attack: 0.01, out });
      });
      tone(c, { type: 'sine', f: hz(98), t: t + 0.55, dur: 0.6, peak: 0.008, attack: 0.05, out });
    } },

    // ---- ambient (through the very low ambient gain)
    birds: { dur: 0.9, ambient: true, fn(c, t, out) {
      const n = 3 + Math.floor(Math.random() * 3);
      let dt = 0;
      for (let i = 0; i < n; i++) {
        const f = 3000 + Math.random() * 1400;
        tone(c, { type: 'sine', f, f2: f * (Math.random() < 0.5 ? 1.3 : 0.75), t: t + dt, dur: 0.07, peak: 0.03, attack: 0.005, out });
        dt += 0.09 + Math.random() * 0.1;
      }
    } },
    owl: { dur: 1.2, ambient: true, fn(c, t, out) {
      tone(c, { type: 'sine', f: 400, f2: 360, t, dur: 0.36, peak: 0.05, attack: 0.06, lp: 900, out });
      tone(c, { type: 'sine', f: 390, f2: 370, t: t + 0.6, dur: 0.14, peak: 0.035, attack: 0.03, lp: 900, out });
      tone(c, { type: 'sine', f: 395, f2: 350, t: t + 0.78, dur: 0.38, peak: 0.045, attack: 0.05, lp: 900, out });
    } },
    hammer: { dur: 1.1, ambient: true, fn(c, t, out) {
      for (let i = 0; i < 3; i++) {
        const tt = t + i * 0.42;
        noise(c, { t: tt, dur: 0.08, peak: 0.03, filter: 'bandpass', freq: 1700, q: 6, out });
        tone(c, { type: 'triangle', f: 520, t: tt, dur: 0.14, peak: 0.025, attack: 0.002, lp: 2000, out });
      }
    } },
    wind: { dur: 1.2, ambient: true, fn(c, t, out) {
      noise(c, { t, dur: 1.2, peak: 0.05, filter: 'bandpass', freq: 300, freq2: 900, sweep: 0.6, freq3: 380, q: 1.5, attack: 0.5, out });
    } },
    // Rain (failing tests): a soft hiss with scattered drops.
    rain: { dur: 1.8, ambient: true, fn(c, t, out) {
      noise(c, { t, dur: 1.8, peak: 0.03, filter: 'highpass', freq: 2400, attack: 0.5, out });
      noise(c, { t, dur: 1.8, peak: 0.02, filter: 'bandpass', freq: 900, q: 0.8, attack: 0.6, out });
      for (let i = 0; i < 16; i++) {
        noise(c, { t: t + 0.2 + Math.random() * 1.4, dur: 0.012, peak: 0.008 + Math.random() * 0.02, filter: 'bandpass', freq: 3000 + Math.random() * 2500, q: 4, out });
      }
    } },
    // Distant thunder over Mordor (limit nearly reached): a low rolling rumble.
    thunder: { dur: 2, ambient: true, fn(c, t, out) {
      noise(c, { t, dur: 0.25, peak: 0.05, filter: 'lowpass', freq: 900, freq2: 300, attack: 0.01, out });
      noise(c, { t: t + 0.1, dur: 1.9, peak: 0.07, filter: 'lowpass', freq: 220, freq2: 90, sweep: 1.6, attack: 0.15, out });
      tone(c, { type: 'sine', f: 55, f2: 38, t: t + 0.1, dur: 1.4, peak: 0.04, attack: 0.08, out });
    } },
    fire: { dur: 1.2, ambient: true, fn(c, t, out) {
      noise(c, { t, dur: 1.2, peak: 0.02, filter: 'lowpass', freq: 220, attack: 0.3, out });
      for (let i = 0; i < 12; i++) {
        noise(c, { t: t + Math.random() * 1.1, dur: 0.015, peak: 0.01 + Math.random() * 0.03, filter: 'highpass', freq: 1500, out });
      }
    } },
  };

  function dropSfx(name, why) {
    const k = `${name}:${why}`;
    sfxState.dropped[k] = (sfxState.dropped[k] || 0) + 1;
    return false;
  }

  /** Plays one effect if allowed; returns true when it was played. opts.force skips the anvil's dice roll. */
  function playSfx(name, opts) {
    const def = SFX[name];
    if (!def) return false;
    if (!sfxState.enabled) return dropSfx(name, 'off');
    const now = performance.now();
    if (!def.alert && now - sfxState.last < SFX_GAP_MS) return dropSfx(name, 'spam');
    if (name === 'anvil') {
      if (now - sfxState.lastAnvil < ANVIL_GAP_MS) return dropSfx(name, 'gap');
      if (!(opts && opts.force) && Math.random() > ANVIL_CHANCE) return dropSfx(name, 'chance');
    }
    const c = getCtx();
    // Never as a late burst: if the context is not running right now, the effect is lost.
    if (!c || c.state !== 'running') return dropSfx(name, 'suspended');
    const b = getBus();
    try {
      def.fn(c, c.currentTime + 0.02, def.ambient ? b.ambient : b.sfx);
    } catch {
      return dropSfx(name, 'error');
    }
    sfxState.last = now;
    if (name === 'anvil') sfxState.lastAnvil = now;
    sfxState.lastName = name;
    sfxState.counts[name] = (sfxState.counts[name] || 0) + 1;
    if (def.duck && (music.playing || (custom.el && !custom.el.paused))) duck(def.dur);
    return true;
  }

  // ------------------------------------------------------------ ambient
  // One tiny sound every 60 to 180 s, chosen from the state of the map given by the app:
  // birds by day / owl at night, distant hammer when agents code, wind or campfire when all is calm,
  // rain when tests fail, thunder when Mordor's storm rages.

  let ambientProvider = null;
  let ambientTimer = null;
  let ambientNext = 0;
  function pickAmbient(st) {
    const creature = st && st.night ? 'owl' : 'birds';
    const r = Math.random();
    if (st && st.storm && r < 0.5) return 'thunder';
    if (st && st.rain && r < 0.6) return 'rain';
    if (st && st.coding) return r < 0.7 ? 'hammer' : creature;
    if (st && st.calm) return r < 0.35 ? 'wind' : r < 0.7 ? 'fire' : creature;
    return creature;
  }
  function scheduleAmbient() {
    clearTimeout(ambientTimer);
    const delay = (60 + Math.random() * 120) * 1000;
    ambientNext = Date.now() + delay;
    ambientTimer = setTimeout(() => {
      let st = null;
      try {
        st = ambientProvider ? ambientProvider() : null;
      } catch {
        st = null;
      }
      playSfx(pickAmbient(st));
      scheduleAmbient();
    }, delay);
  }
  scheduleAmbient();

  getCtx(); // create at load: in the macOS WebView it runs without a gesture

  function status() {
    return {
      state: ctx ? ctx.state : 'none',
      currentTime: ctx ? ctx.currentTime : 0,
      hadGesture,
      visibility: document.visibilityState,
      musicWanted: music.wanted,
      source: music.source,
      generatedPlaying: music.playing,
      customPlaying: !!(custom.el && !custom.el.paused),
      notes: music.notes,
      sfx: Object.values(sfxState.counts).reduce((p, q) => p + q, 0),
      muted,
      masterGain: bus ? Math.round(bus.master.gain.value * 100) / 100 : null,
    };
  }

  window.LOTRAudio = {
    ctx: getCtx,
    beep,
    resume,
    status,
    onStateChange(fn) {
      if (typeof fn === 'function') stateListeners.push(fn);
    },
    setLevels,
    setMuted,
    get muted() {
      return muted;
    },
    music: {
      start: startMusic,
      stop: stopMusic,
      setTension,
      setSource,
      get source() {
        return music.source;
      },
      get customName() {
        return custom.name;
      },
      onCustomError(fn) {
        onCustomError = typeof fn === 'function' ? fn : null;
      },
    },
    sfx: {
      play: playSfx,
      names: Object.keys(SFX),
      setEnabled(on) {
        sfxState.enabled = !!on;
      },
    },
    ambient: {
      setProvider(fn) {
        ambientProvider = typeof fn === 'function' ? fn : null;
      },
    },
  };

  // Read-only debug view (console: __lotrAudio.state, __lotrAudio.music, __lotrAudio.sfx).
  Object.defineProperty(window, '__lotrAudio', {
    value: Object.freeze({
      get state() {
        return ctx ? ctx.state : 'none';
      },
      get currentTime() {
        return ctx ? ctx.currentTime : 0;
      },
      get hadGesture() {
        return hadGesture;
      },
      get lastResume() {
        return lastResume;
      },
      get beeps() {
        return beeps;
      },
      get levels() {
        return {
          ...levels,
          muted,
          masterGain: bus ? bus.master.gain.value : 0,
          musicBusGain: bus ? bus.music.gain.value : 0,
          sfxBusGain: bus ? bus.sfx.gain.value : 0,
          duckGain: bus ? bus.duck.gain.value : 1,
          ducks,
        };
      },
      get sfx() {
        return {
          enabled: sfxState.enabled,
          names: Object.keys(SFX),
          counts: { ...sfxState.counts },
          dropped: { ...sfxState.dropped },
          last: sfxState.lastName,
          msSinceLast: Number.isFinite(sfxState.last) ? Math.round(performance.now() - sfxState.last) : null,
          ambientInS: Math.max(0, Math.round((ambientNext - Date.now()) / 1000)),
        };
      },
      get music() {
        const bar = Math.floor(music.step / STEPS_PER_BAR);
        return {
          wanted: music.wanted,
          source: music.source,
          playing: music.playing,
          tension: music.tension,
          shadow: music.shadow,
          step: music.step,
          bar,
          section: FORM[Math.floor(bar / BARS_PER_SECTION)][0],
          nextTime: music.nextTime,
          notesScheduled: music.notes,
          loops: music.loops,
          loopSeconds: TOTAL_STEPS * EIGHTH,
          masterGain: music.nodes ? music.nodes.master.gain.value : 0,
          leadGain: music.nodes ? music.nodes.lead.gain.value : 0,
          droneHighHz: music.nodes ? music.nodes.drones[1].frequency.value : 0,
          custom: {
            name: custom.name,
            playing: !!(custom.el && !custom.el.paused),
            time: custom.el ? custom.el.currentTime : 0,
            gain: custom.gain ? custom.gain.gain.value : 0,
            error: custom.error,
          },
        };
      },
    }),
  });
})();
