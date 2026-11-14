'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const I18N = require('../public/js/i18n');
const C = require('../public/js/conlang');

const FR = require('../public/i18n/fr');
I18N.register('fr', FR);
const FANTASY = ['elf', 'dwarf', 'ent'];

/** Every text of a dictionary value (string, variants or plural forms). */
const texts = (v) => (typeof v === 'string' ? [v] : Array.isArray(v) ? v : Object.values(v));
/** Neutral params for every placeholder of a value (digits: never translated). */
function paramsFor(v) {
  const p = { count: 2, v: 0 };
  for (const s of texts(v)) for (const m of String(s).matchAll(/\{(\w+)\}/g)) if (!(m[1] in p)) p[m[1]] = 'Q7';
  return p;
}
/** Whether a French text has words the conlang must translate (not only params, names, units). */
function translatable(s) {
  let x = String(s).replace(/\{\w+\}/g, ' ');
  for (const k of C.DATA.keep) x = x.split(k).join(' ');
  const words = x.split(/\s+/).filter((c) => !/[\p{L}\p{N}][._@~][\p{L}\p{N}]/u.test(c)).join(' ').match(/[\p{L}\p{M}\p{N}]+/gu) || [];
  return words.some((w) => !/\p{N}/u.test(w) && [...w].length > 1 && !(w === w.toUpperCase() && [...w].length <= 4));
}

test('deterministic: same French word -> same invented word, in any sentence', () => {
  for (const lang of FANTASY) {
    const a = C.translate(lang, 'Le nain forge le fichier');
    assert.equal(C.translate(lang, 'Le nain forge le fichier'), a);
    const nain = C.translate(lang, 'nain');
    assert.ok(a.includes(nain), `${lang}: ${a} / ${nain}`);
    assert.ok(C.translate(lang, 'Un nain endormi').includes(nain));
    // A generated word (not in the lexicon) is stable too, and keeps the capital letter.
    const g = C.translate(lang, 'pagination');
    assert.notEqual(g, 'pagination');
    assert.equal(C.translate(lang, 'Pagination'), g[0].toUpperCase() + g.slice(1));
    assert.equal(C.translate(lang, 'PAGINATION'), g.toUpperCase());
  }
});

test('names of the languages, in the languages', () => {
  const names = FANTASY.map((l) => C.name(l));
  assert.deepEqual(names, ['Velisaine', 'Zgördrak', 'Moorvaaloorooma']);
  for (const l of FANTASY) assert.equal(I18N.BY_CODE[l].native, C.name(l));
});

test('params, numbers, punctuation and emoji are never transformed', () => {
  const actor = { key: 'actor.coding', params: { project: 'LOTRAgent', tag: '' } };
  for (const lang of FANTASY) {
    const edit = I18N.tl(lang, 'log.edit', { actor, file: 'server.js', v: 0 });
    assert.match(edit, /LOTRAgent/);
    assert.match(edit, /server\.js/);
    assert.doesNotMatch(edit, /nain|forge/);
    const bash = I18N.tl(lang, 'log.bashTest', { actor, cmd: 'npm test -- --grep "la carte du nain"' });
    assert.ok(bash.includes('npm test -- --grep "la carte du nain"'), bash);
    const grep = I18N.tl(lang, 'log.grepIn', { actor, pat: 'TODO|le nain', dir: 'lib/' });
    assert.ok(grep.includes('« TODO|le nain »') || grep.includes('TODO|le nain'), grep);
    const prompt = I18N.tl(lang, 'log.prompt', { project: 'AFT-CUP', prompt: 'Ajoute la pagination sur la liste' });
    assert.ok(prompt.includes('Ajoute la pagination sur la liste'), prompt);
    assert.ok(I18N.tl(lang, 'log.webfetch', { actor, host: 'docs.example.com' }).includes('docs.example.com'));
    assert.ok(I18N.tl(lang, 'log.bag', { who: 'P', pct: '82' }).includes('82'));
    assert.match(I18N.tl(lang, 'app.titleWaiting', { count: 3 }), /\(3\)…? 🔥/);
    assert.equal(I18N.tl(lang, 'dur.hmin', { h: 1, m: 26 }), '1 h 26 min');
    assert.equal(I18N.tl(lang, 'fmt.pct', { n: 52 }), '52 %');
    // Protected commands inside a template stay usable.
    assert.ok(I18N.tl(lang, 'gauge.empty').includes('npm run install-statusline'));
    // Nested messages are translated, raw strings are not.
    const waits = I18N.tl(lang, 'log.alert', { who: 'P', msg: { key: 'wait.permission', params: { tool: 'Bash' } } });
    assert.doesNotMatch(waits, /permission|réponse/);
    assert.match(waits, /Bash/);
  }
});

test('every French key is translated in elf / dwarf / ent (no French left, no hole)', () => {
  for (const lang of FANTASY) {
    for (const [key, v] of Object.entries(FR)) {
      const params = paramsFor(v);
      const out = I18N.tl(lang, key, params);
      const fr = I18N.tl('fr', key, params);
      assert.doesNotMatch(out, /undefined|\{\w+\}|[\u0001\u0002]/, `${lang} ${key}: ${out}`);
      if (texts(v).some(translatable)) assert.notEqual(out, fr, `${lang} ${key}`);
    }
  }
});

test('gloss: French text when the language is an invented one, null otherwise', () => {
  const prev = I18N.getLang();
  try {
    I18N.setLang('elf');
    assert.equal(I18N.gloss('wait.input'), 'Attend ta réponse');
    assert.equal(I18N.gloss('alert.waitsTitle', { who: 'LOTRAgent' }), 'LOTRAgent attend ta réponse');
    assert.equal(I18N.glossMsg({ key: 'wait.permission', params: { tool: 'Bash' } }), "Demande la permission d'utiliser Bash");
    assert.equal(I18N.glossMsg({ text: 'déjà en français' }), null);
    assert.match(I18N.withGloss(I18N.t('detail.close'), 'detail.close'), /\n— Fermer$/);
    I18N.setLang('en');
    assert.equal(I18N.gloss('wait.input'), null);
    assert.equal(I18N.withGloss('Close', 'detail.close'), 'Close');
  } finally {
    I18N.setLang(prev);
  }
});

// Forbidden forms (Tolkien): words, roots, typical endings. The list of the data file must hold them.
const REQUIRED_BLACKLIST = ['mellon', 'elen', 'sila', 'lumenn', 'omentielvo', 'namarie', 'aiya', 'galad', 'mithril', 'mae', 'govannen',
  'lorien', 'anor', 'ithil', 'edhel', 'quendi', 'eldar', 'baruk', 'khazad', 'aimenu', 'gimli', 'durin', 'uzbad', 'felak', 'burzum',
  'nazg', 'ash', 'hoomrum', 'lalla', 'rumba', 'kamanda'];

test('blacklist: no Tolkien word, root or ending in the lexicons nor in any generated text', () => {
  const bl = C.DATA.blacklist;
  for (const w of REQUIRED_BLACKLIST) assert.ok(bl.words.includes(w), w);
  for (const s of ['iel', 'ion', 'wen', 'dil', 'dor']) assert.ok(bl.suffixes.includes(s), s);
  assert.ok(bl.contains.includes('kh'));
  // The check itself.
  for (const w of ['Mellon', 'galadhrim', 'Khazâd', 'Durin', 'avariel', 'vasion', 'eowen', 'ash']) assert.ok(C.isBanned(w), w);
  assert.ok(!C.isBanned('torvessa'));

  for (const lang of FANTASY) {
    for (const [fr, w] of C.lexicon(lang)) {
      assert.ok(!C.isBanned(w), `${lang} lexicon: ${fr} -> ${w}`);
      if (lang === 'dwarf') assert.doesNotMatch(w, /[âêîôû]/, w);
    }
    // Every word of every French text, generated or from the lexicon.
    const seen = new Set();
    for (const v of Object.values(FR)) for (const s of texts(v)) for (const w of s.match(/\p{L}+/gu) || []) seen.add(w.toLowerCase());
    for (const w of seen) {
      const out = C.translate(lang, w);
      assert.ok(!C.isBanned(out) || out === w, `${lang}: ${w} -> ${out}`);
    }
    // And the rendered texts of the whole dictionary.
    for (const [key, v] of Object.entries(FR)) {
      const out = I18N.tl(lang, key, paramsFor(v));
      assert.doesNotMatch(out, /hoom-rum|a-lalla|rumba|kamanda/i, `${lang} ${key}`);
      if (lang === 'dwarf') assert.doesNotMatch(out, /[âêîôû]|kh/i, `${lang} ${key}: ${out}`);
      for (const w of out.match(/[\p{L}\p{M}]+/gu) || []) {
        if (C.DATA.keep.some((k) => k.split(/\W+/).includes(w))) continue; // product names kept as they are
        assert.ok(!C.isBanned(w), `${lang} ${key}: « ${w} » in ${out}`);
      }
    }
  }
});

test('phonologies: elf flowing, dwarf clustered consonants, ent long and stretched', () => {
  const sample = Object.values(FR).flatMap(texts).join(' ');
  const words = (lang) => C.translate(lang, sample).toLowerCase().match(/\p{L}+/gu).filter((w) => !/^[a-z]$/.test(w));
  const avg = (ws) => ws.reduce((n, w) => n + w.length, 0) / ws.length;
  const elf = words('elf');
  const dwarf = words('dwarf');
  const ent = words('ent');
  assert.ok(avg(ent) > avg(elf) && avg(ent) > avg(dwarf), `ent ${avg(ent)} elf ${avg(elf)} dwarf ${avg(dwarf)}`);
  const share = (ws, re) => ws.filter((w) => re.test(w)).length / ws.length;
  assert.ok(share(dwarf, /[bcdfgkmnprstvz]{2}/) > 0.5, 'dwarf clusters');
  assert.ok(share(ent, /aa|oo|uu/) > 0.6, 'ent long vowels');
  assert.ok(share(elf, /[aeiouy]$|[lnsr]$/) > 0.8, 'elf soft endings');
});

// Parity with the macOS app: same algorithm in Swift (macos/Sources/Conlang.swift), same data file.
const ROOT = path.join(__dirname, '..');
const swiftc = spawnSync('swiftc', ['--version'], { encoding: 'utf8' });
test('macOS app: Swift port gives the same invented texts (skipped without swiftc)', { skip: swiftc.status !== 0 ? 'swiftc absent' : false, timeout: 240000 }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'conlang-'));
  try {
    const bin = path.join(dir, 'conlang-tool');
    execFileSync('swiftc', ['-O', '-swift-version', '5', path.join(ROOT, 'macos/Sources/Conlang.swift'), path.join(ROOT, 'macos/ConlangTool/main.swift'), '-o', bin], { stdio: 'pipe' });
    const lines = [];
    for (const lang of FANTASY) for (const v of Object.values(FR)) for (const s of texts(v)) lines.push(lang + '\t' + s.replace(/\n/g, ' '));
    const out = execFileSync(bin, [], {
      input: lines.join('\n') + '\n',
      env: { ...process.env, LOTR_CONLANG_DATA: path.join(ROOT, 'public/js/conlang-data.js') },
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    }).split('\n');
    lines.forEach((l, i) => {
      const [lang, s] = l.split('\t');
      assert.equal(out[i], C.translate(lang, s), `${lang}: ${s}`);
    });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('macOS app strings (L10n.swift, French table): invented without any blacklisted form', () => {
  const src = fs.readFileSync(path.join(ROOT, 'macos/Sources/L10n.swift'), 'utf8');
  const start = src.indexOf('static let fr: [String: String] = [');
  const end = src.indexOf('\n    ]', start);
  assert.ok(start > 0 && end > start);
  const values = [...src.slice(start, end).matchAll(/^\s*"[\w.]+": "((?:[^"\\]|\\.)*)",?$/gm)].map((m) => m[1].replace(/\\n/g, '\n').replace(/\\"/g, '"'));
  assert.ok(values.length > 50, String(values.length));
  for (const lang of FANTASY) {
    for (const v of values) {
      const out = C.translate(lang, v);
      for (const w of out.match(/[\p{L}\p{M}]+/gu) || []) {
        if (C.DATA.keep.some((k) => k.split(/\W+/).includes(w))) continue;
        assert.ok(!C.isBanned(w), `${lang}: « ${w} » in ${out}`);
      }
    }
  }
});
