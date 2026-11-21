/* Pixel-art sprites, all drawn in code (original art).
 * Each sprite is a list of rows; each char is a palette key ('.' = transparent).
 * Sprites are rendered once into small cached canvases with an automatic 1px outline.
 */
(function () {
  'use strict';

  const PAL = {
    k: '#2a1d14', s: '#f1c49a', S: '#c98e63', h: '#7a4521', H: '#4a2812',
    g: '#3f7d3a', G: '#2b5527', y: '#e3c25a', Y: '#b8952f', b: '#7a4b2a', B: '#4f2f17',
    o: '#e07b2c', O: '#a5521b', r: '#b93b2f', R: '#7c2219', w: '#f4efe1', W: '#c9c3b6',
    a: '#9a968f', A: '#625f5a', u: '#3d6fb6', U: '#284a7e', l: '#bfe3ff',
    p: '#8a4fb0', P: '#5d3179', f: '#ff8c1a', F: '#ffe066', e: '#f0d890', E: '#c9a95a',
    c: '#5e8f4a', C: '#3c6431', t: '#8aa070', T: '#5e7349', m: '#c3c9d1', M: '#717985',
    n: '#9c6b3c', N: '#6b4423', q: '#f3e7c6', Q: '#c7b48a', x: '#151515', z: '#ffffff',
  };
  const OUTLINE = 'rgba(30,20,12,0.9)';

  const HOBBIT_TOP = [
    '..hhhh..',
    '.hhhhhh.',
    'hhssssh.',
    '.sxssxs.',
    '..ssss..',
    '.gyyyyg.',
    'sgyyyygs',
    '.gGggGg.',
  ];
  const DWARF_TOP = [
    '..mmmm..',
    '.mmmmmm.',
    'MMMMMMMM',
    '.sxssxs.',
    '.osSSso.',
    'oooooooo',
    'rooooooR',
    'rroooorR',
    'rbbyybbR',
    '.NNNNNN.',
  ];
  const WIZ_TOP = [
    '....a...',
    '...aa...',
    '...aaa..',
    '..aaaa..',
    '..aaaaa.',
    'aaaaaaaa',
    '.sxssxs.',
    '.wwSSww.',
    'awwwwwwa',
    'aawwwwaa',
    'aaawwaaa',
    '.aaaaaa.',
    '.AaaaaA.',
  ];
  const ELF_TOP = [
    '..eeee..',
    '.eeeeee.',
    '.esssse.',
    'sexssxes',
    '.essssE.',
    '.ccyycc.',
    'cccccccC',
    'scccccCs',
    '.ccccCC.',
    '.bbbbbb.',
  ];
  const TROLL_TOP = [
    '...tttt...',
    '..tttttt..',
    '..txttxt..',
    '..tTttTt..',
    '..twTTwt..',
    '.tttttttt.',
    'tttttttttt',
    'tT.bbbb.Tt',
    't..bbbb..t',
    '...bNNb...',
  ];

  const DEFS = {
    hobbit_0: HOBBIT_TOP.concat(['..bbbb..', '..b..b..', '.ss..ss.']),
    hobbit_1: HOBBIT_TOP.concat(['..bbbb..', '.b....b.', 'ss....ss']),
    hobbit_sit: [
      '..hhhh..', '.hhhhhh.', 'hhssssh.', '.sxssxs.', '..ssss..',
      '.gyyyyg.', 'sgyyyygs', '.gggggbb', '..bbbbss',
    ],
    hobbit_wave: [
      '..hhhh...', '.hhhhhh.s', 'hhssssh.s', '.sxssxs.g', '..ssss..g',
      '.gyyyygg.', 'sgyyyyg..', '.gGggGg..', '..bbbb...', '..b..b...', '.ss..ss..',
    ],
    dwarf_0: DWARF_TOP.concat(['.NN..NN.', '.xx..xx.']),
    dwarf_1: DWARF_TOP.concat(['NN....NN', 'xx....xx']),
    hammer_up: ['MMM.', 'mmm.', 'MMM.', '.n..', '.n..', '.n..'],
    hammer_down: ['....MM', 'nnnnmm', '....MM'],
    anvil: ['mmmmmmm', '.MmmmM.', '..MMM..', '.MMMMM.'],
    wizard_0: WIZ_TOP.concat(['.AA..AA.']),
    wizard_1: WIZ_TOP.concat(['AA....AA']),
    staff: ['.l.', 'lzl', '.l.', '.n.', '.n.', '.n.', '.n.', '.n.', '.n.', '.n.', '.n.', '.n.', '.n.', '.N.'],
    staff_dim: ['.W.', 'WaW', '.W.', '.n.', '.n.', '.n.', '.n.', '.n.', '.n.', '.n.', '.n.', '.n.', '.n.', '.N.'],
    elf_0: ELF_TOP.concat(['.b....b.', '.B....B.']),
    elf_1: ELF_TOP.concat(['..b..b..', '..B..B..']),
    beret: ['.rrrr..', 'rrrrrrr'],
    loupe: ['.mm..', 'mllm.', 'mllm.', '.mmn.', '...nn'],
    scroll: ['QqqqQ', 'QqQqQ', 'QqqqQ'],
    easel: [
      'QQQQQQ.', 'QqqqqQ.', 'QqqqqQ.', 'QqqqqQ.', 'QQQQQQ.',
      '.n..n..', '.n..n..', 'n....n.', 'n....n.',
    ],
    troll_0: TROLL_TOP.concat(['..TT..TT..', '..TT..TT..', '.TTT..TTT.']),
    troll_1: TROLL_TOP.concat(['.TT....TT.', '.TT....TT.', 'TTT....TTT']),
    club_up: ['.NN.', 'NnnN', 'NnnN', '.nn.', '..n.', '..n.', '..n.'],
    club_down: ['....NNN', 'nnnnnnN', '....NNN'],
    rock: ['..aaa..', '.aaWaa.', 'aaaaaaA', 'aAaaaAA', '.AAAAA.'],
    beacon: ['nNnNnNn', '.nNnNn.', 'WWWWWWW', 'WaWWaWW', 'WWWaWWW', 'aWWWWaW', 'WWWWWWW'],
    flame_0: ['..F..', '.FfF.', '.fFf.', 'fffff', '.frf.'],
    flame_1: ['.F...', '..Ff.', '.fFF.', 'ffFff', '.frf.'],
    logs: ['n.....n', '.nN.Nn.', '..NNN..'],
    eagle_0: ['bB...Bb..', '.bB.Bb...', '..bbbbbwy', '...BBB...'],
    eagle_1: ['...bbbb..', '..bbbbbwy', '.bB.Bb...', 'bB...Bb..'],
    // Porter of a marching troop: a small hobbit bent under a big pack (bedroll on top), facing right.
    porter_0: [
      '.QQQ....', 'nnnn.hh.', 'nNNnhhhh', 'nNnn.sxs', 'nnNn.ss.',
      '.nngyyg.', '..ggyygs', '...bbbb.', '...b..b.', '..ss..ss',
    ],
    porter_1: [
      '.QQQ....', 'nnnn.hh.', 'nNNnhhhh', 'nNnn.sxs', 'nnNn.ss.',
      '.nngyyg.', '..ggyygs', '...bbbb.', '....bb..', '...ssss.',
    ],
    letter: ['qqq', 'QqQ'],
    glyph_z: ['www', '.w.', 'www'],
    glyph_excl: ['rr', 'rr', 'rr', '..', 'rr'],
    bubble_dots: ['.wwwwwww.', 'wwwwwwwww', 'wwxwxwxww', 'wwwwwwwww', '.wwwwwww.', '..ww.....', '.w.......'],
    bubble_q: ['.wwwww.', 'wwxxxww', 'wwwwxww', 'wwwxxww', 'wwwwwww', 'wwwxwww', '.wwwww.', '.ww....'],
    bubble_mail: ['.wwwwwww.', 'wqqqqqqqw', 'wqQqqqQqw', 'wqqQqQqqw', 'wqqqQqqqw', '.wwwwwww.', '..ww.....'],
  };

  // Painter = elf with dark hair and a purple robe.
  const PAINTER_REMAP = { e: 'h', E: 'H', c: 'p', C: 'P', y: 'F' };

  const cache = new Map();

  function build(name, remap, outline) {
    const rows = DEFS[name];
    if (!rows) throw new Error('unknown sprite ' + name);
    const w = Math.max(...rows.map((r) => r.length));
    const h = rows.length;
    const cv = document.createElement('canvas');
    cv.width = w + 2;
    cv.height = h + 2;
    const ctx = cv.getContext('2d');
    const opaque = new Uint8Array((w + 2) * (h + 2));
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < rows[y].length; x++) {
        const ch = rows[y][x];
        if (ch !== '.') opaque[(y + 1) * (w + 2) + x + 1] = 1;
      }
    }
    if (outline) {
      ctx.fillStyle = OUTLINE;
      for (let y = 0; y < h + 2; y++) {
        for (let x = 0; x < w + 2; x++) {
          if (opaque[y * (w + 2) + x]) continue;
          const n = (yy, xx) => yy >= 0 && yy < h + 2 && xx >= 0 && xx < w + 2 && opaque[yy * (w + 2) + xx];
          if (n(y - 1, x) || n(y + 1, x) || n(y, x - 1) || n(y, x + 1)) ctx.fillRect(x, y, 1, 1);
        }
      }
    }
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < rows[y].length; x++) {
        let ch = rows[y][x];
        if (ch === '.') continue;
        if (remap && remap[ch]) ch = remap[ch];
        ctx.fillStyle = PAL[ch] || '#ff00ff';
        ctx.fillRect(x + 1, y + 1, 1, 1);
      }
    }
    return cv;
  }

  function get(name, opts) {
    const remap = opts && opts.remap;
    const outline = !(opts && opts.outline === false);
    const key = name + '|' + (remap ? JSON.stringify(remap) : '') + '|' + outline;
    let c = cache.get(key);
    if (!c) {
      c = build(name, remap, outline);
      cache.set(key, c);
    }
    return c;
  }

  function size(name) {
    const rows = DEFS[name];
    return { w: Math.max(...rows.map((r) => r.length)), h: rows.length };
  }

  /** Draws a sprite with its top-left (without outline) at (x, y). */
  function draw(ctx, name, x, y, opts) {
    const c = get(name, opts);
    x = Math.round(x);
    y = Math.round(y);
    const alpha = opts && opts.alpha != null ? opts.alpha : 1;
    if (alpha <= 0) return;
    const prev = ctx.globalAlpha;
    if (alpha !== 1) ctx.globalAlpha = prev * alpha;
    if (opts && opts.flip) {
      ctx.save();
      ctx.translate(x - 1 + c.width, y - 1);
      ctx.scale(-1, 1);
      ctx.drawImage(c, 0, 0);
      ctx.restore();
    } else {
      ctx.drawImage(c, x - 1, y - 1);
    }
    ctx.globalAlpha = prev;
  }

  /** Draws a sprite anchored at its feet (bottom-center). */
  function drawFeet(ctx, name, fx, fy, opts) {
    const s = size(name);
    draw(ctx, name, fx - Math.floor(s.w / 2), fy - s.h, opts);
  }

  // ------------------------------------------------------------ figures

  const AVATAR_FRAMES = {
    hobbit: ['hobbit_0', 'hobbit_1'],
    dwarf: ['dwarf_0', 'dwarf_1'],
    wizard: ['wizard_0', 'wizard_1'],
    scout: ['elf_0', 'elf_1'],
    painter: ['elf_0', 'elf_1'],
    troll: ['troll_0', 'troll_1'],
  };

  function strikeIndex(t) {
    return Math.floor(t * 2.4);
  }
  function strikeDown(t) {
    return (t * 2.4) % 1 > 0.55;
  }

  /** Draws a character avatar at its feet (fx, fy). */
  function drawAvatar(ctx, avatar, fx, fy, t, o) {
    o = o || {};
    const frames = AVATAR_FRAMES[avatar] || AVATAR_FRAMES.hobbit;
    let name = frames[o.walking ? Math.floor(t * 6) % 2 : 0];
    if (avatar === 'hobbit' && o.pose === 'sit') name = 'hobbit_sit';
    if (avatar === 'hobbit' && o.pose === 'wave') name = 'hobbit_wave';
    const opts = { flip: o.flip, alpha: o.alpha, remap: avatar === 'painter' ? PAINTER_REMAP : null };
    const s = size(name);
    const left = fx - 4;
    const top = fy - s.h + (o.pose === 'sit' && avatar !== 'hobbit' ? 2 : 0);
    if (avatar === 'wizard') draw(ctx, o.glow ? 'staff' : 'staff_dim', o.flip ? left + 7 : left - 2, fy - 15, { alpha: o.alpha });
    draw(ctx, name, left, top, opts);
    if (avatar === 'painter') draw(ctx, 'beret', left, top - 1, { alpha: o.alpha, flip: o.flip });
    if (avatar === 'scout' && o.loupe) draw(ctx, 'loupe', o.flip ? left - 3 : left + 6, fy - 8, { alpha: o.alpha, flip: o.flip });
  }

  /**
   * Draws a "work" figure performing its action, anchored at the worker's feet.
   * work: 'dwarf' (forge), 'wizard' (cast), 'scout' (search), 'painter' (paint), 'troll' (smash)
   */
  function drawWork(ctx, work, fx, fy, t, o) {
    o = o || {};
    const alpha = o.alpha;
    switch (work) {
      case 'dwarf': {
        draw(ctx, 'anvil', fx + 4, fy - 4, { alpha });
        draw(ctx, 'dwarf_0', fx - 4, fy - 12, { alpha });
        if (strikeDown(t)) draw(ctx, 'hammer_down', fx + 3, fy - 7, { alpha });
        else draw(ctx, 'hammer_up', fx + 3, fy - 16, { alpha });
        break;
      }
      case 'troll': {
        draw(ctx, 'rock', fx + 5, fy - 5, { alpha });
        draw(ctx, 'troll_0', fx - 6, fy - 13, { alpha });
        if (strikeDown(t + 0.2)) draw(ctx, 'club_down', fx + 3, fy - 8, { alpha });
        else draw(ctx, 'club_up', fx + 3, fy - 19, { alpha });
        break;
      }
      case 'wizard': {
        const glow = Math.floor(t * 3) % 3 !== 0;
        drawAvatar(ctx, 'wizard', fx, fy, t, { glow, alpha });
        break;
      }
      case 'scout': {
        drawAvatar(ctx, 'scout', fx, fy, t, { walking: o.walking, flip: o.flip, loupe: true, alpha });
        break;
      }
      case 'painter': {
        draw(ctx, 'easel', fx + 4, fy - 9, { alpha });
        // Dabs of paint appearing on the canvas over time.
        const colors = ['#b93b2f', '#3d6fb6', '#e3c25a', '#3f7d3a', '#8a4fb0', '#e07b2c'];
        const step = Math.floor(t * 1.5) % 14;
        const seed = Math.floor(t * 1.5 / 14);
        const prev = ctx.globalAlpha;
        if (alpha != null) ctx.globalAlpha = prev * alpha;
        for (let i = 0; i < Math.min(step, 12); i++) {
          const k = (i * 7 + seed * 3) % 12;
          ctx.fillStyle = colors[(i + seed) % colors.length];
          ctx.fillRect(fx + 5 + (k % 4), fy - 8 + Math.floor(k / 4), 1, 1);
        }
        ctx.globalAlpha = prev;
        drawAvatar(ctx, 'painter', fx, fy, t, { alpha });
        // Brush going back and forth.
        if (Math.floor(t * 2.5) % 2 === 0) {
          ctx.fillStyle = '#e07b2c';
          ctx.fillRect(fx + 3, fy - 7, 1, 1);
        }
        break;
      }
      default:
        drawAvatar(ctx, work, fx, fy, t, { alpha });
    }
  }

  function drawCampfire(ctx, fx, fy, t, alpha) {
    draw(ctx, 'logs', fx - 3, fy - 3, { alpha });
    draw(ctx, Math.floor(t * 5) % 2 ? 'flame_1' : 'flame_0', fx - 2, fy - 7, { alpha, outline: false });
  }

  function drawBeacon(ctx, fx, fy, t, lit, alpha) {
    draw(ctx, 'beacon', fx - 3, fy - 7, { alpha });
    if (lit) {
      const f = Math.floor(t * 6) % 2;
      draw(ctx, f ? 'flame_1' : 'flame_0', fx - 2, fy - 12, { alpha, outline: false });
      draw(ctx, f ? 'flame_0' : 'flame_1', fx - 2, fy - 15, { alpha, outline: false });
    }
  }

  // Second porter of a troop: blue cloak.
  const PORTER_REMAP = { g: 'u', G: 'U' };
  /** Porter of a marching troop at its feet (fx, fy); o: { flip, alpha, alt (blue cloak) }. */
  function drawPorter(ctx, fx, fy, t, o) {
    o = o || {};
    const name = Math.floor(t * 6) % 2 ? 'porter_1' : 'porter_0';
    draw(ctx, name, fx - 4, fy - 10, { flip: o.flip, alpha: o.alpha, remap: o.alt ? PORTER_REMAP : null });
  }

  /** Legend: a small rain cloud (dark when stormy) with falling drops / a lightning bolt. */
  function drawWeatherIcon(c, t, storm) {
    const cloud = storm ? ['#3a3442', '#2a2430'] : ['#a9b0ba', '#868d98'];
    const blobs = [[5, 6, 4], [10, 4, 5], [15, 6, 4]];
    for (let y = 0; y < 11; y++) {
      for (let x = 0; x < 21; x++) {
        let inside = false;
        for (const [bx, by, br] of blobs) if ((x - bx) ** 2 + ((y - by) * 1.5) ** 2 < br * br) inside = true;
        if (!inside) continue;
        c.fillStyle = y > 6 ? cloud[1] : cloud[0];
        c.fillRect(x, y, 1, 1);
      }
    }
    c.fillStyle = storm ? '#9fb0d0' : '#7fa6d8';
    for (let i = 0; i < 6; i++) {
      const x = 3 + i * 3;
      const y = 10 + ((Math.floor(t * 14) + i * 5) % 10);
      c.fillRect(x - Math.floor((y - 10) / 4), y, 1, 2);
    }
    if (storm && Math.floor(t * 2.5) % 3 === 0) {
      c.fillStyle = '#fff6c8';
      for (const [x, y] of [[11, 9], [10, 10], [10, 11], [9, 12], [10, 13], [11, 13], [10, 14], [9, 15], [9, 16]]) c.fillRect(x, y, 1, 1);
    }
  }

  function drawEagle(ctx, x, y, t, flip) {
    const s = size('eagle_0');
    draw(ctx, Math.floor(t * 7) % 2 ? 'eagle_1' : 'eagle_0', x - Math.floor(s.w / 2), y - 2, { flip });
    draw(ctx, 'letter', x - 1, y + 2, {});
  }

  // Tiny procedural figures for the rare ambient crossings (no sprite sheet needed).
  function px(ctx, color, x, y, w, h) {
    ctx.fillStyle = color;
    ctx.fillRect(x, y, w || 1, h || 1);
  }

  /** Rider of Rohan galloping right; (x, y) = hooves line. */
  function drawRider(ctx, x, y, t) {
    const g = Math.floor(t * 10) % 2;
    px(ctx, '#6b4a2b', x - 3, y - 4, 7, 2); // horse body
    px(ctx, '#6b4a2b', x + 3, y - 6, 2, 2); // neck / head
    px(ctx, '#3b2716', x - 4, y - 5, 1, 2); // tail
    px(ctx, '#3b2716', g ? x - 3 : x - 2, y - 2, 1, 2);
    px(ctx, '#3b2716', g ? x + 3 : x + 2, y - 2, 1, 2);
    px(ctx, '#2f5130', x - 1, y - 8, 2, 4); // green cloak
    px(ctx, '#d8b878', x - 1, y - 9, 2, 1); // golden hair
    px(ctx, '#c9c2b0', x + 1, y - 12, 1, 4); // spear
  }

  /** Winged nazgûl, flying left; (x, y) = centre. */
  function drawNazgul(ctx, x, y, t) {
    const up = Math.floor(t * 4) % 2;
    const c = '#120c14';
    px(ctx, c, x - 1, y - 1, 4, 2); // body
    px(ctx, c, x - 3, y, 2, 1); // head / neck
    px(ctx, c, x + 3, y + 1, 3, 1); // tail
    if (up) {
      px(ctx, c, x - 1, y - 3, 3, 2);
      px(ctx, c, x - 2, y - 5, 2, 2);
      px(ctx, c, x - 3, y - 6, 1, 1);
    } else {
      px(ctx, c, x - 1, y + 1, 3, 2);
      px(ctx, c, x - 2, y + 3, 2, 1);
      px(ctx, c, x - 4, y + 4, 2, 1);
    }
    px(ctx, '#2a1c30', x + 1, y - 2, 1, 1); // rider
  }

  /** Gollum crouching along; (x, y) = feet line. */
  function drawGollum(ctx, x, y, t, flip) {
    const k = Math.floor(t * 6) % 2;
    const d = flip ? -1 : 1;
    px(ctx, '#8e9a6a', x - 1, y - 3, 3, 2); // hunched back
    px(ctx, '#a7b07c', x + d * 2, y - 4, 2, 2); // head
    px(ctx, '#d8f070', x + d * (d > 0 ? 3 : 2), y - 4, 1, 1); // pale eye
    px(ctx, '#7c8858', k ? x - 1 : x, y - 1, 1, 1);
    px(ctx, '#7c8858', k ? x + 1 : x + 2, y - 1, 1, 1);
  }

  /** Renders a legend icon into a small canvas (scale = CSS px per sprite px). */
  function drawIcon(canvas, kind, t, scale) {
    scale = scale || 2;
    const W = 22, H = 22;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = W * scale * dpr;
    canvas.height = H * scale * dpr;
    canvas.style.width = W * scale + 'px';
    canvas.style.height = H * scale + 'px';
    const off = document.createElement('canvas');
    off.width = W;
    off.height = H;
    const c = off.getContext('2d');
    const fx = 9, fy = 19;
    switch (kind) {
      case 'hobbit': drawAvatar(c, 'hobbit', fx + 2, fy, t, {}); break;
      case 'dwarf': drawWork(c, 'dwarf', fx - 1, fy, t); break;
      case 'wizard': drawWork(c, 'wizard', fx + 2, fy, t); draw(c, 'bubble_dots', fx + 4, 1, {}); break;
      case 'scout': drawWork(c, 'scout', fx, fy, t); break;
      case 'painter': drawWork(c, 'painter', fx - 1, fy, t); break;
      case 'troll': drawWork(c, 'troll', fx - 1, fy, t); break;
      case 'beacon': drawBeacon(c, fx + 2, fy, t, true); break;
      case 'campfire': drawAvatar(c, 'hobbit', fx - 2, fy, t, { pose: 'sit' }); drawCampfire(c, fx + 7, fy, t); break;
      case 'eagle': drawEagle(c, fx + 2, 10, t, false); break;
      case 'troop':
        drawPorter(c, fx - 5, fy, t, { alt: true });
        drawPorter(c, fx + 2, fy, t + 0.3, {});
        drawAvatar(c, 'dwarf', fx + 9, fy, t, { walking: true });
        break;
      case 'rain': drawWeatherIcon(c, t, false); break;
      case 'storm': drawWeatherIcon(c, t, true); break;
      case 'riders':
        drawRider(c, fx - 4, fy, t);
        drawRider(c, fx + 5, fy - 2, t + 0.4);
        break;
      case 'nazgul': drawNazgul(c, fx + 2, 10, t); break;
      default: break;
    }
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(off, 0, 0, canvas.width, canvas.height);
  }

  window.Sprites = {
    PAL, DEFS, get, size, draw, drawFeet, drawAvatar, drawWork, drawCampfire, drawBeacon, drawEagle, drawPorter, drawIcon, drawRider, drawNazgul, drawGollum,
    strikeIndex, strikeDown,
  };
})();
