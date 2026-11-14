'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const I18N = require('../public/js/i18n');
const { Store } = require('../lib/store');

const CODES = ['fr', 'en', 'it', 'es', 'ja']; // elf / dwarf / ent: invented from fr (public/js/conlang.js)
const D = Object.fromEntries(CODES.map((c) => [c, require(`../public/i18n/${c}`)]));
for (const c of CODES) I18N.register(c, D[c]);

/** Every {param} of a dictionary value (string, variants or plural forms). */
function placeholders(v) {
  const parts = typeof v === 'string' ? [v] : Array.isArray(v) ? v : Object.values(v);
  const out = new Set();
  for (const p of parts) for (const m of String(p).matchAll(/\{(\w+)\}/g)) out.add(m[1]);
  return out;
}

test('every French key exists in en, it, es and ja (no missing key in the real languages)', () => {
  for (const lang of ['en', 'it', 'es', 'ja']) {
    const missing = Object.keys(D.fr).filter((k) => !Object.prototype.hasOwnProperty.call(D[lang], k));
    assert.deepEqual(missing, [], `${lang}: missing keys`);
    const extra = Object.keys(D[lang]).filter((k) => !Object.prototype.hasOwnProperty.call(D.fr, k));
    assert.deepEqual(extra, [], `${lang}: keys unknown in fr`);
  }
});

test('translations use the same placeholders as French', () => {
  for (const lang of CODES.filter((c) => c !== 'fr')) {
    for (const [k, v] of Object.entries(D[lang])) {
      assert.ok(Object.prototype.hasOwnProperty.call(D.fr, k), `${lang}: ${k} unknown in fr`);
      assert.deepEqual([...placeholders(v)].sort(), [...placeholders(D.fr[k])].sort(), `${lang}: ${k}`);
    }
  }
});

test('interpolation, variants, plurals and nested messages', () => {
  assert.equal(I18N.tl('fr', 'act.edit', { file: 'server.js' }), 'Édite server.js');
  assert.equal(I18N.tl('en', 'act.edit', { file: 'server.js' }), 'Editing server.js');
  // Unknown param left as is, unknown key returned as is.
  assert.equal(I18N.tl('fr', 'act.edit', {}), 'Édite {file}');
  assert.equal(I18N.tl('fr', 'nope.key'), 'nope.key');
  // Variants picked by params.v.
  const actor = { key: 'actor.coding', params: { project: 'P', tag: '' } };
  assert.equal(I18N.tl('fr', 'log.edit', { actor, file: 'a.js', v: 1 }), 'Le nain de P martèle a.js');
  assert.equal(I18N.tl('fr', 'log.edit', { actor, file: 'a.js', v: 4 }), 'Le nain de P forge a.js');
  // Plurals (Intl.PluralRules).
  assert.equal(I18N.tl('fr', 'alert.count', { count: 1 }), '1 balise allumée');
  assert.equal(I18N.tl('fr', 'alert.count', { count: 3 }), '3 balises allumées');
  assert.equal(I18N.tl('en', 'alert.count', { count: 1 }), '1 beacon lit');
  assert.equal(I18N.tl('en', 'alert.count', { count: 2 }), '2 beacons lit');
  assert.equal(I18N.tl('ja', 'alert.count', { count: 2 }), 'のろし2本');
  // Numbers in the locale of the language.
  assert.equal(I18N.num(1.25, 1, 'fr'), '1,3');
  assert.equal(I18N.num(1.25, 1, 'en'), '1.3');
  assert.equal(I18N.localeOf('dwarf'), 'fr-FR');
  // Nested message in another language + capital letter at the start of the sentence (elf).
  assert.equal(I18N.tl('it', 'log.start', { where: { key: 'terr.shire.where' }, project: 'X' }), 'Una nuova compagnia si risveglia nella Contea: X');
  const elfRead = I18N.tl('elf', 'log.read', { actor: { key: 'actor.think', params: { project: 'P', tag: '' } }, file: 'a.js' });
  assert.match(elfRead, /^[A-Z]\S* .* P .*a\.js$/);
  assert.doesNotMatch(elfRead, /magicien|déchiffre/);
});

test('fallback key by key: real language -> French; invented languages come from French', () => {
  assert.notEqual(I18N.tl('dwarf', 'detail.close'), 'Fermer');
  assert.equal(I18N.tl('dwarf', 'detail.close'), I18N.conlang.translate('dwarf', 'Fermer'));
  assert.equal(I18N.tl('it', 'nope.key'), 'nope.key');
  assert.equal(I18N.detect('ja-JP'), 'ja');
  assert.equal(I18N.detect('de-DE'), 'fr');
  assert.equal(I18N.detect(undefined), 'fr');
});

test('a chronicle entry is rendered in several languages from key/params', () => {
  const s = new Store({ file: null });
  s.ingest({ session_id: 's1', cwd: '/x/LOTRAgent', hook_event_name: 'PreToolUse', tool_name: 'Edit', tool_input: { file_path: '/x/LOTRAgent/server.js' } });
  const e = s.chronicle.at(-1);
  assert.equal(e.key, 'log.edit');
  assert.equal(e.params.file, 'server.js');
  assert.equal(e.params.v, 1); // first Edit of this agent: second variant, as before
  assert.deepEqual(e.params.actor, { key: 'actor.coding', params: { project: 'LOTRAgent', tag: '' } });
  assert.equal(I18N.render(e, 'fr'), e.text); // the French text is the same rendering
  assert.equal(I18N.render(e, 'en'), "LOTRAgent's dwarf hammers server.js");
  assert.equal(I18N.render(e, 'es'), 'El enano de LOTRAgent martillea server.js');
  assert.equal(I18N.render(e, 'ja'), 'LOTRAgentのドワーフがserver.jsを打ち鍛えている');
  assert.match(I18N.render(e, 'dwarf'), /^\S+ \S+ \S+ LOTRAgent \S+ server\.js$/);
  // Old entries (no key) keep their text.
  assert.equal(I18N.render({ text: 'Ancienne entrée' }, 'en'), 'Ancienne entrée');

  s.ingest({ session_id: 's1', hook_event_name: 'Notification', message: 'Claude needs your permission to use Bash' });
  const alert = s.chronicle.at(-1);
  assert.equal(alert.key, 'log.alert');
  assert.equal(I18N.render(alert, 'it'), 'I fuochi d’allarme sono accesi! LOTRAgent aspetta la tua risposta: Chiede il permesso di usare Bash');
  const a = s.agents.get('s1');
  assert.deepEqual(a.waiting.i, { key: 'wait.permission', params: { tool: 'Bash' } });
  assert.equal(I18N.render(a.lastActionI, 'en'), 'Asks permission to use Bash');
});

test('demo texts are translated too (demo.* keys)', () => {
  const s = new Store({ file: null });
  s.ingest({ session_id: 'd1', cwd: '/d/AFT-CUP', hook_event_name: 'UserPromptSubmit', prompt: 'Ajoute la pagination sur la liste des matchs', i18n: { prompt: 'demo.aft.p0' } }, { hook: 'UserPromptSubmit', demo: true });
  const e = s.chronicle.at(-1);
  assert.equal(e.text, 'Une nouvelle quête pour AFT-CUP : « Ajoute la pagination sur la liste des matchs »');
  assert.equal(I18N.render(e, 'en'), 'A new quest for AFT-CUP: “Add pagination to the match list”');
  // Real (non demo) events never carry dictionary keys from the payload.
  s.ingest({ session_id: 'r1', cwd: '/r/P', hook_event_name: 'UserPromptSubmit', prompt: 'vrai prompt', i18n: { prompt: 'demo.aft.p0' } });
  assert.equal(I18N.render(s.chronicle.at(-1), 'en'), 'A new quest for P: “vrai prompt”');
});

test('ent: invented text slowed down, params kept intact, short labels left readable', () => {
  const slow = I18N.entify('Le nain forge le fichier principal', 'k');
  assert.match(slow, /^(Hrrm|Hoom|Hm, hoom)/);
  assert.match(slow, /le… nain… forge…/);
  assert.equal(I18N.entify('Fermer'), 'Fermer');
  assert.equal(I18N.entify(' = '), ' = ');
  assert.equal(I18N.entify('Copié !'), 'Copié !');
  // Deterministic (no flicker on re-render).
  assert.equal(I18N.entify('Le nain forge le fichier principal', 'k'), slow);
  // Invented words slowed, project names untouched.
  const txt = I18N.tl('ent', 'log.watch', { actor: { key: 'actor.running', params: { project: 'api-gateway', tag: '' } } });
  assert.match(txt, /^(Hrrm|Hoom|Hm, hoom)[^]*laa… boorgaaloom… vaa… api-gateway…/);
  const used = I18N.tl('ent', 'gauge.tipUsed', { pct: '52 %' });
  assert.equal(used, '52 % uuloomoo.'); // 3 words or less: left readable (already ends with a dot)
});

test('dwarf runes: simple Elder Futhark transliteration', () => {
  assert.equal(I18N.runes('Thé'), 'ᚦᛖ');
  assert.equal(I18N.runes('La Comté'), 'ᛚᚨ᛫ᚲᛟᛗᛏᛖ');
  for (const ch of I18N.runes('Carte de la Terre du Milieu')) {
    const cp = ch.codePointAt(0);
    assert.ok(cp >= 0x16a0 && cp <= 0x16ff, ch);
  }
  assert.equal(I18N.title('Carte', 'elf'), '✧ Carte ✧');
  assert.equal(I18N.title('Carte', 'dwarf'), 'Carte');
});
