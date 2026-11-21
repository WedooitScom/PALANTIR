/* Procedural, deterministic map of a stylized Middle-earth (original pixel art).
 * The static map is rendered once into an offscreen canvas (world resolution W x H);
 * ambient animations (waves, waterfalls, grass, smoke, clouds, fog, night) are drawn per frame.
 */
(function () {
  'use strict';

  const W = 360;
  const H = 225;

  const TERRITORIES = [
    { key: 'shire', name: 'La Comté', cx: 66, cy: 88, rx: 15, ry: 7, beacon: [83, 83] },
    { key: 'bree', name: 'Bree', cx: 100, cy: 77, rx: 8, ry: 5, beacon: [111, 73] },
    { key: 'rivendell', name: 'Fondcombe', cx: 134, cy: 59, rx: 9, ry: 5, beacon: [144, 62] },
    { key: 'moria', name: 'La Moria', cx: 146, cy: 106, rx: 7, ry: 4, beacon: [135, 103] },
    { key: 'lorien', name: 'La Lothlórien', cx: 190, cy: 99, rx: 9, ry: 5, beacon: [203, 101] },
    { key: 'isengard', name: 'Isengard', cx: 159, cy: 150, rx: 8, ry: 4, beacon: [149, 147] },
    { key: 'rohan', name: 'Le Rohan', cx: 206, cy: 127, rx: 15, ry: 6, beacon: [223, 123] },
    { key: 'gondor', name: 'Le Gondor', cx: 236, cy: 173, rx: 9, ry: 5, beacon: [226, 167] },
    { key: 'mordor', name: 'Le Mordor', cx: 294, cy: 194, rx: 15, ry: 8, beacon: [281, 184] },
    { key: 'erebor', name: 'Erebor', cx: 300, cy: 59, rx: 10, ry: 5, beacon: [315, 58] },
  ];
  const TERR_BY_KEY = Object.fromEntries(TERRITORIES.map((t) => [t.key, t]));

  // ------------------------------------------------------------ noise

  function mulberry32(a) {
    return function () {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function hash2(x, y, s) {
    let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(s | 0, 1442695041);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  }
  function vnoise(x, y, s) {
    const xi = Math.floor(x), yi = Math.floor(y);
    const xf = x - xi, yf = y - yi;
    const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    const a = hash2(xi, yi, s), b = hash2(xi + 1, yi, s), c = hash2(xi, yi + 1, s), d = hash2(xi + 1, yi + 1, s);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  }
  function fbm(x, y, s, oct) {
    oct = oct || 4;
    let sum = 0, amp = 0.5, f = 1, norm = 0;
    for (let i = 0; i < oct; i++) {
      sum += amp * vnoise(x * f, y * f, s + i * 17);
      norm += amp;
      amp *= 0.5;
      f *= 2;
    }
    return sum / norm;
  }
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const mix = (c1, c2, k) => [c1[0] + (c2[0] - c1[0]) * k, c1[1] + (c2[1] - c1[1]) * k, c1[2] + (c2[2] - c1[2]) * k];
  const css = (c) => `rgb(${c[0] | 0},${c[1] | 0},${c[2] | 0})`;
  function inEll(x, y, cx, cy, rx, ry, j) {
    const dx = (x - cx) / rx, dy = (y - cy) / ry;
    return dx * dx + dy * dy < 1 + (j || 0);
  }

  // ------------------------------------------------------------ geography

  function coastX(y) {
    return 32 + 16 * fbm(0.5, y * 0.07, 11, 3) + 15 * Math.exp(-(((y - 60) / 7) ** 2)) + (y > 166 ? (y - 166) * 1.55 : 0);
  }
  function mistyX(y) {
    return 156 + 3 * Math.sin(y * 0.09) + (fbm(y * 0.05, 0.5, 7, 2) - 0.5) * 6;
  }

  const C = {
    seaDeep: [62, 100, 128], sea: [80, 124, 148], shallow: [118, 160, 172], sand: [214, 198, 142],
    grass: [126, 160, 88], grass2: [104, 140, 74], shire: [140, 180, 92], shire2: [118, 164, 80],
    plains: [184, 178, 98], plains2: [164, 160, 88], north: [168, 170, 140], east: [150, 150, 96],
    ash: [94, 66, 58], ash2: [70, 50, 46], dead: [146, 124, 88], parch: [233, 216, 166],
    forest: [70, 108, 60], mirk: [46, 76, 50], gold: [196, 176, 84], river: [86, 138, 168], road: [196, 168, 112],
  };
  const TREE = {
    mirk: { c: [36, 66, 42], C: [24, 46, 30], t: [70, 50, 34] },
    forest: { c: [62, 112, 56], C: [42, 82, 42], t: [92, 64, 40] },
    old: { c: [54, 98, 52], C: [36, 70, 38], t: [86, 60, 38] },
    gold: { c: [238, 200, 76], C: [196, 150, 46], t: [222, 220, 206] },
  };
  const MPAL = {
    misty: { light: [184, 168, 142], dark: [132, 116, 98], edge: [82, 68, 56], snowL: [246, 242, 234], snowD: [204, 204, 210] },
    mordor: { light: [98, 72, 66], dark: [62, 44, 42], edge: [32, 20, 20] },
    erebor: { light: [170, 162, 152], dark: [116, 108, 104], edge: [66, 60, 58], snowL: [240, 240, 236], snowD: [200, 202, 208] },
    doom: { light: [108, 64, 54], dark: [70, 40, 36], edge: [34, 18, 16] },
  };

  function forestAt(x, y, j) {
    if (inEll(x, y, 190, 99, 6, 4)) return null; // clearing of Lothlórien
    if (inEll(x, y, 250, 80, 20, 30, j)) return 'mirk';
    if (inEll(x, y, 190, 98, 12, 8, j)) return 'gold';
    if (inEll(x, y, 176, 121, 8, 6, j)) return 'forest';
    if (inEll(x, y, 93, 93, 7, 5, j)) return 'old';
    if (inEll(x, y, 119, 47, 6, 4, j)) return 'forest';
    return null;
  }

  const RIVERS = [
    { w: 2, pts: [[218, 12], [224, 36], [222, 60], [227, 84], [225, 108], [229, 132], [226, 152], [220, 176], [200, 194], [176, 206], [150, 214], [126, 223]] },
    { w: 1, pts: [[86, 30], [84, 56], [82, 80], [84, 100], [80, 128], [72, 154], [62, 178]] },
    { w: 1, pts: [[140, 46], [132, 64], [124, 84], [112, 104], [98, 124], [82, 132]] },
    { w: 1, pts: [[168, 148], [150, 162], [126, 180], [100, 196], [86, 200]] },
    { w: 1, pts: [[195, 99], [210, 104], [226, 108]] },
    { w: 1, pts: [[312, 52], [313, 66], [318, 80], [322, 98]] },
  ];
  const ROADS = [
    [[56, 90], [70, 88], [84, 82], [100, 77], [118, 66], [132, 59]],
    [[206, 128], [214, 140], [226, 160], [236, 172]],
  ];

  // ------------------------------------------------------------ build

  function build(seed) {
    seed = seed || 1337;
    const rng = mulberry32(seed);
    const base = document.createElement('canvas');
    base.width = W;
    base.height = H;
    const ctx = base.getContext('2d');
    const img = ctx.createImageData(W, H);
    const D = img.data;
    const type = new Uint8Array(W * H); // 0 land, 1 water, 2 ash, 3 forest, 5 plains
    const forest = new Array(W * H);

    for (let y = 0; y < H; y++) {
      const cx = coastX(y);
      for (let x = 0; x < W; x++) {
        const n1 = fbm(x * 0.06, y * 0.06, seed + 1, 3);
        const j = (n1 - 0.5) * 0.7;
        let col;
        let t = 0;
        const rhun = inEll(x, y, 336, 106, 15, 9, j);
        if (x < cx || rhun) {
          t = 1;
          const d = rhun ? 6 : cx - x;
          col = d < 2.5 ? C.shallow : d < 10 ? C.sea : C.seaDeep;
          col = mix(col, C.seaDeep, clamp((fbm(x * 0.1, y * 0.1, seed + 9, 2) - 0.5) * 0.6, 0, 0.3));
        } else if (x < cx + 1.6) {
          col = C.sand;
        } else if (x > 263 && x < 354 && y > 147 && y < 213) {
          t = 2;
          col = mix(C.ash, C.ash2, clamp(n1 * 1.4 - 0.2, 0, 1));
        } else {
          col = mix(C.grass, C.grass2, clamp((n1 - 0.35) * 2.5, 0, 1));
          if (y < 32) col = mix(col, C.north, clamp((32 - y) / 16, 0, 1));
          if (x > 296 && y > 20 && y < 140) col = mix(col, C.east, 0.35);
          if (x > 238 && x < 264 && y > 108 && y < 150) col = mix(col, C.dead, 0.6);
          if (inEll(x, y, 206, 127, 28, 13, j)) {
            t = 5;
            col = mix(C.plains, C.plains2, clamp((n1 - 0.3) * 2, 0, 1));
          }
          if (inEll(x, y, 66, 87, 21, 12, j)) col = mix(C.shire, C.shire2, clamp((n1 - 0.3) * 2, 0, 1));
          if (inEll(x, y, 134, 58, 11, 6, j)) col = mix(col, [84, 120, 70], 0.5); // Rivendell valley
          const fk = forestAt(x, y, j);
          if (fk) {
            t = 3;
            forest[y * W + x] = fk;
            col = fk === 'mirk' ? C.mirk : fk === 'gold' ? C.gold : C.forest;
          } else if (inEll(x, y, 190, 99, 6, 4)) {
            col = mix(C.gold, C.grass, 0.4);
          }
        }
        // Dither + parchment tint + vignette.
        const dth = (hash2(x, y, seed) - 0.5) * 10;
        col = mix(col, C.parch, 0.16);
        const e = Math.min(x, y, W - 1 - x, H - 1 - y);
        const v = e < 16 ? (16 - e) * 0.016 : 0;
        const i = (y * W + x) * 4;
        D[i] = clamp(col[0] * (1 - v) + dth, 0, 255);
        D[i + 1] = clamp(col[1] * (1 - v) + dth, 0, 255);
        D[i + 2] = clamp(col[2] * (1 - v * 1.2) + dth, 0, 255);
        D[i + 3] = 255;
        type[y * W + x] = t;
      }
    }
    ctx.putImageData(img, 0, 0);

    function px(x, y, c, w, h) {
      ctx.fillStyle = typeof c === 'string' ? c : css(c);
      ctx.fillRect(Math.round(x), Math.round(y), w || 1, h || 1);
    }
    function pattern(x, y, rows, pal) {
      for (let r = 0; r < rows.length; r++) {
        for (let q = 0; q < rows[r].length; q++) {
          const ch = rows[r][q];
          if (ch !== '.' && pal[ch]) px(x + q, y + r, pal[ch]);
        }
      }
    }

    // Rivers & roads (noisy polylines).
    function polyline(pts, cb) {
      let dist = 0;
      for (let k = 0; k < pts.length - 1; k++) {
        const [x0, y0] = pts[k], [x1, y1] = pts[k + 1];
        const len = Math.hypot(x1 - x0, y1 - y0);
        const nx = -(y1 - y0) / len, ny = (x1 - x0) / len;
        for (let s = 0; s < len; s += 0.5) {
          const f = s / len;
          const wob = (fbm(dist * 0.07, k * 3.1, seed + 21, 2) - 0.5) * 5;
          cb(x0 + (x1 - x0) * f + nx * wob, y0 + (y1 - y0) * f + ny * wob, dist);
          dist += 0.5;
        }
      }
    }
    for (const r of RIVERS) {
      polyline(r.pts, (x, y) => {
        px(x, y, C.river, r.w, 1);
        if (r.w > 1) px(x, y + 1, mix(C.river, [40, 70, 100], 0.3), 1, 1);
      });
    }
    for (const road of ROADS) {
      polyline(road, (x, y, d) => {
        if (Math.floor(d) % 3 !== 0) px(x, y, C.road);
      });
    }
    // Long lake near Erebor.
    for (let y = 66; y < 76; y++) for (let x = 315; x < 320; x++) if (inEll(x, y, 317, 71, 2.4, 5)) px(x, y, C.sea);

    // Shire hills.
    const hills = [[54, 84], [63, 80], [75, 81], [80, 91], [55, 94], [70, 95], [46, 88]];
    for (const [hx, hy] of hills) {
      px(hx - 2, hy - 4, [170, 206, 116], 5, 1);
      px(hx - 4, hy - 3, [164, 202, 110], 5, 1);
      px(hx + 1, hy - 3, [132, 174, 88], 4, 1);
      px(hx - 5, hy - 2, [152, 194, 102], 6, 1);
      px(hx + 1, hy - 2, [122, 164, 82], 5, 1);
      px(hx - 6, hy - 1, [140, 184, 94], 6, 1);
      px(hx, hy - 1, [112, 152, 76], 7, 1);
      px(hx - 6, hy, [84, 120, 60], 13, 1);
    }

    // Trees.
    for (let y = 6; y < H - 6; y += 3) {
      for (let x = 6; x < W - 6; x += 3) {
        const jx = x + Math.floor(hash2(x, y, seed + 5) * 2);
        const jy = y + Math.floor(hash2(x, y, seed + 6) * 2);
        const k = forest[jy * W + jx];
        if (!k) {
          if (type[jy * W + jx] === 0 && hash2(x, y, seed + 8) < 0.012) stampTree(jx, jy, TREE.forest, false);
          continue;
        }
        if (hash2(x, y, seed + 7) < 0.16) continue;
        if (k === 'gold') {
          if ((x + y) % 2 === 0) stampTree(jx, jy, TREE.gold, true);
          else stampTree(jx, jy, TREE.gold, false);
        } else stampTree(jx, jy, TREE[k] || TREE.forest, false);
      }
    }
    function stampTree(x, y, p, big) {
      if (big) {
        px(x - 1, y - 5, p.c, 3, 1);
        px(x - 2, y - 4, p.c, 5, 1);
        px(x - 2, y - 3, p.c, 1, 1); px(x - 1, y - 3, p.C, 1, 1); px(x, y - 3, p.c, 1, 1); px(x + 1, y - 3, p.C, 1, 1); px(x + 2, y - 3, p.c, 1, 1);
        px(x - 1, y - 2, p.c, 1, 1); px(x, y - 2, p.C, 1, 1); px(x + 1, y - 2, p.c, 1, 1);
        px(x, y - 1, p.t, 1, 2);
      } else {
        px(x, y - 3, p.c);
        px(x - 1, y - 2, p.c, 3, 1);
        px(x - 1, y - 1, p.c); px(x, y - 1, p.C); px(x + 1, y - 1, p.C);
        px(x, y, p.t);
      }
    }

    // Mountains (icons sorted by base y).
    const mounts = [];
    const addM = (x, y, h, pal, snowy) => mounts.push({ x: Math.round(x), y: Math.round(y), h, pal, snowy });
    for (let y = 16; y <= 138; y += 4) {
      addM(mistyX(y) + (rng() - 0.5) * 3, y, 6 + Math.floor(rng() * 3), MPAL.misty, true);
      if (rng() < 0.5) addM(mistyX(y) + (rng() < 0.5 ? -5 : 5), y + 2, 4 + Math.floor(rng() * 2), MPAL.misty, false);
    }
    addM(mistyX(90), 92, 10, MPAL.misty, true);
    for (let x = 168; x <= 286; x += 6) addM(x + (rng() - 0.5) * 3, 19 + (rng() - 0.5) * 4, 4 + Math.floor(rng() * 3), MPAL.misty, rng() < 0.5);
    for (let x = 178; x <= 250; x += 5) addM(x, 151 + (x - 178) * 0.09 + (rng() - 0.5) * 3, 5 + Math.floor(rng() * 3), MPAL.misty, true);
    for (let x = 262; x <= 352; x += 5) addM(x + (rng() - 0.5) * 2, 149 + (rng() - 0.5) * 3, 5 + Math.floor(rng() * 2), MPAL.mordor, false);
    for (let y = 155; y <= 212; y += 5) addM(262 + (rng() - 0.5) * 3, y, 5 + Math.floor(rng() * 2), MPAL.mordor, false);
    for (let x = 270; x <= 350; x += 7) addM(x, 216 + (rng() - 0.5) * 2, 4, MPAL.mordor, false);
    for (let x = 330; x <= 350; x += 6) addM(x, 44 + (rng() - 0.5) * 3, 4, MPAL.misty, false);
    addM(300, 50, 15, MPAL.erebor, true);
    addM(318, 184, 11, MPAL.doom, false);
    mounts.sort((a, b) => a.y - b.y);
    for (const m of mounts) stampMountain(m);
    function stampMountain(m) {
      const { x, y, h, pal, snowy } = m;
      const snowRows = snowy ? Math.ceil(h * 0.34) : 0;
      for (let r = 0; r < h; r++) {
        const yy = y - h + 1 + r;
        for (let dx = -r; dx <= r; dx++) {
          let col;
          if (dx === -r || dx === r) col = pal.edge;
          else if (r < snowRows) col = dx < 0 ? pal.snowL : pal.snowD;
          else col = dx < 0 ? pal.light : pal.dark;
          px(x + dx, yy, col);
        }
      }
    }

    // ---------------- landmarks
    const FP = {
      w: '#efe9d8', W: '#c9c1ad', g: '#9a9284', d: '#262022', k: '#3a2a1c', r: '#8a3b2a', R: '#62281c',
      y: '#ffd866', b: '#7a5434', B: '#553a22', G: '#4f7d3c', t: '#5c8f7a', T: '#3f6b5c', m: '#d7e0ea',
      o: '#e0b040', O: '#a87a22', s: '#b0a890', x: '#141012', l: '#ff7a2a', u: '#3d6fb6', e: '#7aa65a',
    };
    const lights = [];

    // Shire: round hobbit doors in the hills + party tree.
    const doors = [[54, 83, '#3f7d3a'], [63, 79, '#e0b040'], [75, 80, '#b93b2f'], [80, 90, '#3d6fb6'], [55, 93, '#3f7d3a'], [70, 94, '#e0b040']];
    for (const [dx, dy, dc] of doors) {
      pattern(dx - 2, dy - 3, ['.kkk.', 'kdddk', 'kdddk', 'kdddk'], { d: dc, k: '#5a3a1e' });
      px(dx + 1, dy - 1, '#ffd866');
      px(dx + 4, dy - 2, '#ffe9a0');
      lights.push([dx + 4, dy - 2]);
    }
    stampTree(66, 80, { c: [96, 150, 70], C: [70, 120, 52], t: [96, 66, 40] }, true);

    // Grey Havens lighthouse.
    pattern(56, 52, ['.y.', 'wWw', '.w.', '.r.', '.w.', 'WWW'], FP);
    lights.push([57, 52]);

    // Bree: houses and the inn.
    pattern(94, 69, ['..rr..', '.rrrr.', 'rrrrrr', 'wywwbw', 'wwwwbw'], FP);
    pattern(102, 70, ['...RRR...', '..RRRRR..', '.RRRRRRR.', 'RRRRRRRRR', 'wywwbwywo', 'wwwwbwwwk'], FP);
    pattern(97, 80, ['.rrr.', 'rrrrr', 'wwyww'], FP);
    lights.push([95, 72], [103, 74], [108, 74], [99, 82]);

    // Rivendell: cliffs, waterfalls, elven houses.
    pattern(125, 46, ['ggs', 'gsg', 'sgg', 'ggs', 'gsg', 'sgg', 'ggs', 'gsg', 'sgg'], FP);
    pattern(141, 45, ['sgg', 'gsg', 'ggs', 'sgg', 'gsg', 'ggs', 'sgg', 'gsg'], FP);
    pattern(130, 53, ['.tttt.', 'tttttt', 'wwywww', 'wwwwyw'], FP);
    pattern(136, 51, ['..tt..', '.tttt.', 'tttttt', 'wywwww', 'wwwwyw'], FP);
    lights.push([132, 55], [137, 54], [141, 55]);
    const falls = [{ x: 126, y0: 46, y1: 54 }, { x: 142, y0: 45, y1: 53 }];

    // Moria: the gate in the mountain flank.
    pattern(148, 96, ['W.mmm.W', 'WmxxxmW', 'WmxmxmW', 'WmxxxmW', 'WmxxxmW', 'WmxxxmW', 'ggggggg'], FP);
    px(151, 97, '#e8f0ff');

    // Lothlórien: a few giant golden trees around the clearing.
    for (const [tx, ty] of [[182, 96], [198, 95], [186, 104], [196, 104]]) {
      pattern(tx - 2, ty - 7, ['.ccc.', 'ccccc', 'cCcCc', 'ccccc', '.cCc.', '..t..', '..t..'], { c: '#f2cf58', C: '#c99a34', t: '#e4e2d6' });
    }

    // Isengard: the ring and the black tower.
    for (let a = 0; a < 360; a += 4) {
      const rx = 169 + Math.cos((a * Math.PI) / 180) * 7;
      const ry = 140 + Math.sin((a * Math.PI) / 180) * 5;
      px(rx, ry, '#4a4a48');
    }
    for (let y = 136; y < 145; y++) for (let x = 163; x < 176; x++) if (inEll(x, y, 169, 140, 6, 4)) px(x, y, (x + y) % 3 ? '#5a5c50' : '#4c4e44');
    pattern(167, 127, ['x...x', 'xx.xx', '.xxx.', '.xgx.', '.xxx.', '.xxx.', '.xxx.', '.xgx.', '.xxx.', '.xxx.', '.xxx.', 'xxxxx', 'xxxxx'], FP);

    // Rohan: Edoras, the golden hall on its hill.
    px(209, 136, '#b8b060', 11, 1);
    px(210, 135, '#c4bc6c', 9, 1);
    pattern(210, 128, ['....r....', '....b....', '..ooooo..', '.oooOooo.', 'bbbbbbbbb', 'bbybbbybb'], FP);
    lights.push([212, 133], [216, 133]);

    // Gondor: the white city with tiers against the mountain.
    const mtX = 248, mtY = 166;
    for (let i = 0; i < 4; i++) {
      const rx = 9 - i * 2;
      const cy = mtY - i * 2;
      for (let x = -rx; x <= rx; x++) {
        const hgt = Math.round(Math.sqrt(Math.max(0, 1 - (x / (rx + 0.5)) ** 2)) * 3);
        for (let y = 0; y <= hgt; y++) px(mtX + x, cy - y, y === hgt ? '#9e9a90' : '#f0ede4');
      }
    }
    pattern(247, 150, ['.r.', '.w.', '.w.', 'www', 'wWw', 'www'], FP);
    lights.push([244, 163], [252, 163], [246, 160], [250, 160], [248, 157]);

    // Mordor: lava cracks, the dark tower.
    for (let k = 0; k < 9; k++) {
      let x = 270 + rng() * 70, y = 156 + rng() * 50;
      for (let s = 0; s < 10; s++) {
        if (type[(y | 0) * W + (x | 0)] === 2) px(x, y, '#7a2a1a');
        x += (rng() - 0.3) * 2;
        y += (rng() - 0.5) * 2;
      }
    }
    pattern(335, 146, [
      'x.x.x', 'xxxxx', '.xxx.', '.xlx.', '.xxx.', '.xxx.', '.xxx.', 'xxxxx', 'xxxxx', 'xxlxx',
      'xxxxx', 'xxxxx', 'xxxxx', 'xxxxx', 'xxxxx', 'xxxxx',
    ], FP);
    px(334, 158, '#141012', 7, 4);
    const lava = [];
    {
      let x = 318, y = 175;
      for (let s = 0; s < 10; s++) {
        lava.push([x, y]);
        y += 1;
        x += s % 3 === 0 ? 1 : 0;
      }
    }
    px(317, 174, '#ff5a1a', 3, 1);

    // Erebor gate.
    pattern(298, 45, ['.ooo.', '.xxx.', '.xxx.', '.xxx.', 'sssss'], FP);
    lights.push([300, 46]);

    // Compass rose in the western sea.
    {
      const cxr = 22, cyr = 198;
      const P = '#ead9a8', Rr = '#b93b2f', K = '#3a2a1c';
      for (let d = 1; d <= 6; d++) { px(cxr, cyr - d, d > 4 ? Rr : P); px(cxr, cyr + d, P); }
      for (let d = 1; d <= 4; d++) { px(cxr - d, cyr, P); px(cxr + d, cyr, P); }
      for (let d = 1; d <= 2; d++) { px(cxr - d, cyr - d, K); px(cxr + d, cyr - d, K); px(cxr - d, cyr + d, K); px(cxr + d, cyr + d, K); }
      px(cxr, cyr, Rr);
      pattern(cxr - 1, cyr - 12, ['P.P', 'PPP', 'PPP', 'P.P'], { P });
    }

    // Frame.
    ctx.fillStyle = '#3a2614';
    ctx.fillRect(0, 0, W, 2); ctx.fillRect(0, H - 2, W, 2); ctx.fillRect(0, 0, 2, H); ctx.fillRect(W - 2, 0, 2, H);
    ctx.fillStyle = '#b48a46';
    ctx.fillRect(2, 2, W - 4, 1); ctx.fillRect(2, H - 3, W - 4, 1); ctx.fillRect(2, 2, 1, H - 4); ctx.fillRect(W - 3, 2, 1, H - 4);

    // ---------------- ambient data
    const waves = [];
    let guard = 0;
    while (waves.length < 260 && guard++ < 20000) {
      const x = 5 + Math.floor(rng() * (W - 10));
      const y = 5 + Math.floor(rng() * (H - 10));
      if (type[y * W + x] !== 1) continue;
      if (type[y * W + x + 4] !== 1 || type[y * W + x - 2] !== 1) continue;
      waves.push({ x, y, ph: rng() * 6.28, sp: 0.6 + rng() * 0.9 });
    }
    const grass = [];
    guard = 0;
    while (grass.length < 150 && guard++ < 20000) {
      const x = 180 + Math.floor(rng() * 54);
      const y = 115 + Math.floor(rng() * 26);
      if (type[y * W + x] !== 5) continue;
      if (Math.abs(x - 214) < 7 && Math.abs(y - 132) < 6) continue;
      grass.push({ x, y, c: rng() < 0.5 ? '#e2d886' : '#a8a456' });
    }

    // Red sky over Mordor.
    const redSky = document.createElement('canvas');
    redSky.width = 110;
    redSky.height = 90;
    {
      const r = redSky.getContext('2d');
      const g = r.createRadialGradient(60, 50, 4, 60, 50, 70);
      g.addColorStop(0, 'rgba(220,60,30,0.38)');
      g.addColorStop(0.6, 'rgba(160,30,20,0.18)');
      g.addColorStop(1, 'rgba(120,20,20,0)');
      r.fillStyle = g;
      r.fillRect(0, 0, 110, 90);
    }

    // Fog sprites for unoccupied territories.
    const fog = {};
    for (const T of TERRITORIES) {
      const fw = (T.rx + 10) * 2, fh = (T.ry + 9) * 2;
      const cv = document.createElement('canvas');
      cv.width = fw;
      cv.height = fh;
      const f = cv.getContext('2d');
      for (let y = 0; y < fh; y++) {
        for (let x = 0; x < fw; x++) {
          const dx = (x - fw / 2) / (fw / 2), dy = (y - fh / 2) / (fh / 2);
          const d = Math.sqrt(dx * dx + dy * dy);
          if (d >= 1) continue;
          const n = fbm(x * 0.18, y * 0.18, seed + T.key.length * 13, 2);
          const a = clamp((1 - d) * 1.1 + (n - 0.5) * 0.8, 0, 1);
          if (hash2(x, y, seed + 77) < a * 0.75) {
            f.fillStyle = `rgba(232,226,210,${0.35 + a * 0.35})`;
            f.fillRect(x, y, 1, 1);
          }
        }
      }
      fog[T.key] = { cv, x: T.cx - fw / 2, y: T.cy - fh / 2 - 3, ph: rng() * 6 };
    }

    // Clouds.
    const clouds = [];
    for (let k = 0; k < 6; k++) {
      const cw = 26 + Math.floor(rng() * 16), ch = 9 + Math.floor(rng() * 4);
      const cv = document.createElement('canvas');
      cv.width = cw;
      cv.height = ch;
      const sh = document.createElement('canvas');
      sh.width = cw;
      sh.height = ch;
      const c1 = cv.getContext('2d'), c2 = sh.getContext('2d');
      const blobs = [];
      for (let b = 0; b < 4; b++) blobs.push([4 + rng() * (cw - 8), ch / 2 + (rng() - 0.3) * 2, 3 + rng() * 5]);
      for (let y = 0; y < ch; y++) {
        for (let x = 0; x < cw; x++) {
          let inside = false;
          for (const [bx, by, br] of blobs) if ((x - bx) ** 2 + ((y - by) * 1.6) ** 2 < br * br) inside = true;
          if (!inside) continue;
          c1.fillStyle = y > ch * 0.62 ? 'rgba(214,208,196,0.78)' : 'rgba(250,247,238,0.82)';
          c1.fillRect(x, y, 1, 1);
          c2.fillStyle = 'rgba(30,24,18,0.14)';
          c2.fillRect(x, y, 1, 1);
        }
      }
      clouds.push({ cv, sh, x: rng() * W, y: 8 + rng() * 170, sp: 1.2 + rng() * 1.6 });
    }

    return {
      base, type, waves, grass, falls, lava, lights, redSky, fog, clouds,
      smoke: [], smokeT: 0, rng,
    };
  }

  // ------------------------------------------------------------ per-frame drawing

  function drawAmbient(ctx, w, t, dt) {
    // Sea waves.
    for (const s of w.waves) {
      const ph = Math.sin(t * s.sp + s.ph);
      if (ph < 0.35) continue;
      const x = s.x + Math.round(Math.sin(t * 0.45 + s.ph) * 1.5);
      ctx.fillStyle = ph > 0.8 ? 'rgba(240,248,250,0.85)' : 'rgba(205,226,236,0.55)';
      ctx.fillRect(x + 1, s.y - 1, 2, 1);
      ctx.fillRect(x, s.y, 1, 1);
      ctx.fillRect(x + 3, s.y, 1, 1);
    }
    // Elven ship sailing west from the Havens.
    {
      const p = (t * 1.6) % 70;
      const x = Math.round(48 - p), y = Math.round(64 + Math.sin(t * 1.3) * 0.6);
      if (x > 4) {
        ctx.fillStyle = '#6b4423'; ctx.fillRect(x - 2, y, 6, 1); ctx.fillRect(x - 1, y + 1, 4, 1);
        ctx.fillStyle = '#f4efe1'; ctx.fillRect(x, y - 3, 2, 3); ctx.fillRect(x + 2, y - 2, 1, 2);
        ctx.fillStyle = '#9c6b3c'; ctx.fillRect(x - 1, y - 4, 1, 4);
      }
    }
    // Waterfalls.
    for (const f of w.falls) {
      for (let y = f.y0; y <= f.y1; y++) {
        const k = Math.floor(y - t * 14) & 3;
        ctx.fillStyle = k === 0 ? '#ffffff' : k === 1 ? '#cfe8f4' : '#86bcd8';
        ctx.fillRect(f.x, y, 1, 1);
      }
      ctx.fillStyle = 'rgba(255,255,255,0.8)';
      const fo = Math.floor(t * 8) % 3;
      ctx.fillRect(f.x - 1 + fo, f.y1 + 1, 1, 1);
      ctx.fillRect(f.x + 1 - fo, f.y1 + 1, 1, 1);
    }
    // Rohan grass waving in the wind.
    for (const g of w.grass) {
      const o = Math.round(Math.sin(t * 2.2 - g.x * 0.16 + g.y * 0.05) * 0.9);
      ctx.fillStyle = g.c;
      ctx.fillRect(g.x + o, g.y - 1, 1, 1);
      ctx.fillRect(g.x, g.y, 1, 1);
    }
    // Red sky over Mordor.
    ctx.globalAlpha = 0.7 + 0.25 * Math.sin(t * 0.8);
    ctx.drawImage(w.redSky, 255, 130);
    ctx.globalAlpha = 1;
    // Lava flowing down Mount Doom.
    for (let i = 0; i < w.lava.length; i++) {
      const [x, y] = w.lava[i];
      const k = (i - Math.floor(t * 6)) & 3;
      ctx.fillStyle = k === 0 ? '#ffd35a' : k === 1 ? '#ff7a2a' : '#c8361a';
      ctx.fillRect(x, y, 1, 1);
    }
    ctx.fillStyle = Math.sin(t * 5) > 0 ? '#ff9a3a' : '#ff5a1a';
    ctx.fillRect(317, 174, 3, 1);
    // Fire atop the dark tower.
    ctx.fillStyle = Math.floor(t * 7) % 2 ? '#ff7a2a' : '#ffcc44';
    ctx.fillRect(337, 145, 1, 1);
    ctx.fillStyle = 'rgba(255,120,40,0.5)';
    ctx.fillRect(336, 144, 3, 1);
    // Lighthouse blink.
    if (Math.floor(t * 1.2) % 2 === 0) {
      ctx.fillStyle = 'rgba(255,240,160,0.9)';
      ctx.fillRect(56, 51, 3, 1);
    }
    // Smoke from Mount Doom.
    w.smokeT -= dt;
    if (w.smokeT <= 0) {
      w.smokeT = 0.18;
      w.smoke.push({ x: 318 + (w.rng() - 0.5) * 2, y: 172, vx: 2 + w.rng() * 2, vy: -4 - w.rng() * 3, life: 0, max: 4 + w.rng() * 3 });
    }
    for (let i = w.smoke.length - 1; i >= 0; i--) {
      const p = w.smoke[i];
      p.life += dt;
      if (p.life > p.max) {
        w.smoke.splice(i, 1);
        continue;
      }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      const k = p.life / p.max;
      const sz = 1 + Math.floor(k * 3);
      ctx.fillStyle = `rgba(${70 - k * 20},${56 - k * 16},${54 - k * 14},${0.75 * (1 - k)})`;
      ctx.fillRect(Math.round(p.x), Math.round(p.y), sz, sz);
    }
  }

  function drawFog(ctx, w, t, active) {
    for (const T of TERRITORIES) {
      if (active.has(T.key)) continue;
      const f = w.fog[T.key];
      ctx.drawImage(f.cv, Math.round(f.x + Math.sin(t * 0.3 + f.ph) * 2), Math.round(f.y));
    }
  }

  function drawClouds(ctx, w, t, dt) {
    for (const c of w.clouds) {
      c.x += c.sp * dt;
      if (c.x > W + 12) {
        c.x = -c.cv.width - 12;
        c.y = 8 + w.rng() * 170;
      }
      const x = Math.round(c.x), y = Math.round(c.y);
      ctx.drawImage(c.sh, x + 6, y + 14);
      ctx.drawImage(c.cv, x, y);
    }
  }

  const NIGHT_MAX = 0.22; // night veil opacity: dark enough to feel like night, light enough to still read the map

  function nightAmount(date) {
    const h = date.getHours() + date.getMinutes() / 60;
    if (h >= 8 && h < 18) return 0;
    if (h >= 18 && h < 21) return ((h - 18) / 3) * NIGHT_MAX;
    if (h >= 21 || h < 5) return NIGHT_MAX;
    return ((8 - h) / 3) * NIGHT_MAX;
  }

  function drawNight(ctx, w, amt, t, extra) {
    if (amt <= 0) return;
    ctx.fillStyle = `rgba(30,36,78,${amt})`;
    ctx.fillRect(0, 0, W, H);
    ctx.globalCompositeOperation = 'lighter';
    const all = extra ? w.lights.concat(extra) : w.lights;
    for (const [x, y] of all) {
      const a = Math.min(1, amt * 2.2) * (0.85 + 0.15 * Math.sin(t * 3 + x));
      ctx.fillStyle = `rgba(255,170,70,${a * 0.35})`;
      ctx.fillRect(x - 1, y - 1, 3, 3);
      ctx.fillStyle = `rgba(255,220,140,${a})`;
      ctx.fillRect(x, y, 1, 1);
    }
    ctx.globalCompositeOperation = 'source-over';
  }

  window.LOTRMap = { W, H, TERRITORIES, TERR_BY_KEY, build, drawAmbient, drawFog, drawClouds, drawNight, nightAmount, hash2, NIGHT_MAX };
})();
