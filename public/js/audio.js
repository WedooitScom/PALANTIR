/* Audio: one shared AudioContext (alert beep + ambient music) and an original
 * 8-bit Celtic pastoral tune synthesised with WebAudio (no audio files). */
(function () {
  'use strict';

  // ------------------------------------------------------------ shared context

  let ctx = null;
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
    const c = getCtx();
    if (c && c.state === 'running') removeUnlock();
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
      if (music.wanted && !music.playing) beginMusic();
    }
  }

  // ------------------------------------------------------------ alert beep

  let beeps = 0;
  function playBeep(c) {
    const t0 = c.currentTime + 0.01;
    [660, 880].forEach((f, i) => {
      const o = c.createOscillator();
      const g = c.createGain();
      o.type = 'square';
      o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, t0 + i * 0.14);
      g.gain.exponentialRampToValueAtTime(0.04, t0 + i * 0.14 + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + i * 0.14 + 0.12);
      o.connect(g).connect(c.destination);
      o.start(t0 + i * 0.14);
      o.stop(t0 + i * 0.14 + 0.13);
    });
    beeps++;
  }
  function beep() {
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
    playing: false,
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
    master.connect(c.destination);

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

  function beginMusic() {
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

  function startMusic() {
    music.wanted = true;
    beginMusic();
  }

  function stopMusic() {
    music.wanted = false;
    if (!music.playing || !ctx || !music.nodes) return;
    ramp(music.nodes.master.gain, 0, ctx.currentTime, 1.5);
    if (music.stopTimer) clearTimeout(music.stopTimer);
    music.stopTimer = setTimeout(() => {
      music.stopTimer = null;
      if (music.wanted) return;
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

  function setTension(on) {
    music.tension = !!on;
  }

  getCtx(); // create at load: in the macOS WebView it runs without a gesture

  window.LOTRAudio = {
    ctx: getCtx,
    beep,
    music: { start: startMusic, stop: stopMusic, setTension },
  };

  // Read-only debug view (console: __lotrAudio.state, __lotrAudio.music).
  Object.defineProperty(window, '__lotrAudio', {
    value: Object.freeze({
      get state() {
        return ctx ? ctx.state : 'none';
      },
      get currentTime() {
        return ctx ? ctx.currentTime : 0;
      },
      get beeps() {
        return beeps;
      },
      get music() {
        const bar = Math.floor(music.step / STEPS_PER_BAR);
        return {
          wanted: music.wanted,
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
        };
      },
    }),
  });
})();
