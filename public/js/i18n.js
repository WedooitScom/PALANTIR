/* i18n: dictionaries, t(key, params), plurals, number/date formatting, fantasy styling.
 *
 * Works in the browser (window.LOTRI18N, dictionaries from public/i18n/<lang>.js) and in Node
 * (require: the server renders the French `text` of its log entries with the same dictionaries).
 *
 * Messages are `{ key, params }`. A param may itself be a message (`{ key, params }`): it is rendered
 * in the same language (territory names, roles, "a scroll"…). Dictionary values:
 *   - a string with {name} placeholders;
 *   - an array of variants, picked by params.v (stable, no randomness);
 *   - a plural object { one, other, … } picked by Intl.PluralRules on params.count.
 * Fallback, key by key: language -> its base (fr for elf / dwarf / ent) -> fr -> the key itself.
 * Ent: a French value used as fallback is slowed down automatically (entify).
 */
(function (root) {
  'use strict';

  const LANGS = [
    { code: 'fr', flag: '🇫🇷', name: 'Français', locale: 'fr-FR' },
    { code: 'en', flag: '🇬🇧', name: 'English', locale: 'en-GB' },
    { code: 'it', flag: '🇮🇹', name: 'Italiano', locale: 'it-IT' },
    { code: 'es', flag: '🇪🇸', name: 'Español', locale: 'es-ES' },
    { code: 'ja', flag: '🇯🇵', name: '日本語', locale: 'ja-JP' },
    { code: 'elf', flag: '🧝', name: 'Elfique', locale: 'fr-FR', base: 'fr', fantasy: true },
    { code: 'dwarf', flag: '⛏️', name: 'Langue des nains', locale: 'fr-FR', base: 'fr', fantasy: true },
    { code: 'ent', flag: '🌳', name: 'Langue des Ents', locale: 'fr-FR', base: 'fr', fantasy: true },
  ];
  const BY_CODE = Object.fromEntries(LANGS.map((l) => [l.code, l]));
  const REAL = ['fr', 'en', 'it', 'es', 'ja'];
  const dicts = {};
  let current = 'fr';
  const listeners = [];

  function isLang(code) {
    return typeof code === 'string' && Object.prototype.hasOwnProperty.call(BY_CODE, code);
  }
  function localeOf(lang) {
    return (BY_CODE[lang] || BY_CODE.fr).locale;
  }
  /** Language from navigator.language (fr/en/it/es/ja), fr otherwise. */
  function detect(navLang) {
    const l = String(navLang || '').toLowerCase().slice(0, 2);
    return REAL.includes(l) ? l : 'fr';
  }

  function register(lang, dict) {
    dicts[lang] = Object.assign(dicts[lang] || {}, dict || {});
  }

  /** The dictionary value for a key, and whether it comes from a fallback language. */
  function lookup(lang, key) {
    const chain = [lang];
    const base = BY_CODE[lang] && BY_CODE[lang].base;
    if (base) chain.push(base);
    if (!chain.includes('fr')) chain.push('fr');
    for (let i = 0; i < chain.length; i++) {
      const d = dicts[chain[i]];
      if (d && Object.prototype.hasOwnProperty.call(d, key)) return { value: d[key], from: chain[i], fallback: i > 0 };
    }
    return null;
  }
  function has(lang, key) {
    return !!(dicts[lang] && Object.prototype.hasOwnProperty.call(dicts[lang], key));
  }

  const pluralCache = {};
  function pluralForm(lang, n) {
    const loc = localeOf(lang);
    try {
      if (!pluralCache[loc]) pluralCache[loc] = new Intl.PluralRules(loc);
      return pluralCache[loc].select(Number(n) || 0);
    } catch {
      return Number(n) === 1 ? 'one' : 'other';
    }
  }

  const numCache = {};
  /** Number in the language's locale, with at most `digits` decimals (0 by default). */
  function num(n, digits, lang) {
    const loc = localeOf(lang || current);
    const d = Number.isFinite(digits) ? digits : 0;
    const k = loc + '|' + d;
    try {
      if (!numCache[k]) numCache[k] = new Intl.NumberFormat(loc, { minimumFractionDigits: d, maximumFractionDigits: d });
      return numCache[k].format(Number(n) || 0);
    } catch {
      return (Number(n) || 0).toFixed(d);
    }
  }
  function date(t, opts, lang) {
    try {
      return new Date(t).toLocaleString(localeOf(lang || current), opts);
    } catch {
      return new Date(t).toLocaleString();
    }
  }
  function time(t, lang) {
    try {
      return new Date(t).toLocaleTimeString(localeOf(lang || current), { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    } catch {
      return new Date(t).toLocaleTimeString();
    }
  }

  function isMsg(v) {
    return !!v && typeof v === 'object' && !Array.isArray(v) && typeof v.key === 'string';
  }

  function pickValue(value, params, lang) {
    if (Array.isArray(value)) {
      const v = Math.abs(Number(params && params.v) | 0);
      return value.length ? value[v % value.length] : '';
    }
    if (value && typeof value === 'object') {
      const n = params ? params.count : undefined;
      const form = pluralForm(lang, n);
      if (Number(n) === 0 && value.zero != null) return value.zero;
      return value[form] != null ? value[form] : value.other != null ? value.other : value.one || '';
    }
    return value == null ? '' : String(value);
  }

  // Sentinels keep the params intact through entify (file names, commands, prompts…).
  const S0 = '\u0001';
  const S1 = '\u0002';

  function paramText(lang, v) {
    if (isMsg(v)) return tl(lang, v.key, v.params, { nested: true });
    if (typeof v === 'number') return num(v, Number.isInteger(v) ? 0 : 1, lang);
    if (v == null) return '';
    return String(v);
  }

  /**
   * Renders a key in a language. opts.nested: inner message (ent: slowed without opener).
   */
  function tl(lang, key, params, opts) {
    if (!isLang(lang)) lang = 'fr';
    const hit = lookup(lang, key);
    if (!hit) return String(key);
    const tpl = pickValue(hit.value, params, hit.from === lang ? lang : hit.from);
    const nested = !!(opts && opts.nested);
    const slow = lang === 'ent' && hit.fallback;
    if (!slow) {
      const out = tpl.replace(/\{(\w+)\}/g, (m, name) => (params && name in params ? paramText(lang, params[name]) : m));
      // A sentence that starts with a nested message ("le mage de X lit…") gets its capital letter.
      const lead = !nested && /^\{(\w+)\}/.exec(tpl);
      return lead && params && isMsg(params[lead[1]]) && startsWithText(lang, params[lead[1]]) ? out.charAt(0).toUpperCase() + out.slice(1) : out;
    }
    // Ent fallback: slow the French template down, then put the params back untouched.
    const vals = [];
    const marked = tpl.replace(/\{(\w+)\}/g, (m, name) => {
      if (!params || !(name in params)) return m;
      vals.push(paramText(lang, params[name]));
      return S0 + (vals.length - 1) + S1;
    });
    const plain = marked.replace(new RegExp(S0 + '(\\d+)' + S1, 'g'), (m, i) => vals[Number(i)]);
    const slowed = nested ? entifyWords(marked) : entify(marked, key, plain.trim().split(/\s+/).length);
    return slowed.replace(new RegExp(S0 + '(\\d+)' + S1, 'g'), (m, i) => vals[Number(i)]);
  }

  /** Whether a message starts with its own words (not with a param such as a project name). */
  function startsWithText(lang, msg) {
    const hit = lookup(lang, msg.key);
    if (!hit) return false;
    const v = hit.value;
    const first = typeof v === 'string' ? v : Array.isArray(v) ? v[0] : v && (v.other || v.one);
    return typeof first === 'string' && !first.startsWith('{');
  }

  function t(key, params) {
    return tl(current, key, params);
  }

  /** A log / action message: { key, params } (with a French `text` fallback for old entries). */
  function render(msg, lang) {
    lang = lang || current;
    if (isMsg(msg)) return tl(lang, msg.key, msg.params);
    if (msg && typeof msg === 'object' && typeof msg.text === 'string') return msg.text;
    return msg == null ? '' : String(msg);
  }

  // ------------------------------------------------------------ Ent: slow French

  function hashStr(s) {
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }
  const ENT_OPEN = ['Hrrm…', 'Hoom…', 'Hm, hoom…', 'Hrrm, hrrm…'];
  const ENT_MID = ['hoom…', 'hrrm…', '…'];
  const PUNCT = /^[!?;:,.»)\]…%]+$/;

  /** Inner part of a slowed sentence (a nested message): every word slowed, no opener, no final "…". */
  function entifyWords(text) {
    const words = String(text == null ? '' : text).trim().split(/\s+/).filter(Boolean);
    if (words.length && /^[A-ZÀ-ÖØ-Þ][a-zà-öø-ÿ']/.test(words[0])) words[0] = words[0][0].toLowerCase() + words[0].slice(1);
    return words.join('… ');
  }

  /**
   * Slows French down: "Le nain forge server.js" -> "Hrrm… le… nain… forge… server.js…".
   * Short texts (1 to 3 words once rendered: buttons, labels, chips) stay as they are, to keep the
   * UI usable. Deterministic (hash of the text), so re-renders do not flicker.
   * text may hold param sentinels (one "word" each); plainWords = word count once rendered.
   */
  function entify(text, seed, plainWords) {
    const raw = String(text == null ? '' : text);
    const s = raw.trim();
    if (!s) return raw;
    if (/^[\s\p{P}\p{S}\d]*$/u.test(s.replace(new RegExp(S0 + '\\d+' + S1, 'g'), ''))) return raw;
    const words = s.split(/\s+/);
    const count = Number.isFinite(plainWords) ? plainWords : words.length;
    if (count <= 3) return raw;
    const h = hashStr(String(seed || '') + s);
    const out = [];
    let open = '';
    let mid = false;
    for (let i = 0; i < words.length; i++) {
      let w = words[i];
      if (w === '«') {
        open = '« ';
        continue;
      }
      if (PUNCT.test(w) && out.length) {
        // "AFT :…", "82 %…", "pagination »…": punctuation sticks to the previous word.
        out[out.length - 1] = out[out.length - 1].replace(/…$/, '') + ' ' + w + (/[.!?…]$/.test(w) ? '' : '…');
        continue;
      }
      if (i === 0 && /^[A-ZÀ-ÖØ-Þ][a-zà-öø-ÿ']/.test(w)) w = w[0].toLowerCase() + w.slice(1);
      out.push(open + (/[….!?]$/.test(w) ? w : w + '…'));
      open = '';
      if (count > 8 && !mid && i >= Math.floor(words.length / 2) && !(i + 1 < words.length && PUNCT.test(words[i + 1]))) {
        mid = true;
        out.push(ENT_MID[h % ENT_MID.length]);
      }
    }
    return ENT_OPEN[h % ENT_OPEN.length] + ' ' + out.join(' ');
  }

  // ------------------------------------------------------------ dwarf runes, elf ornaments

  // Simple letter -> rune transliteration with the historical Elder Futhark (Unicode Runic block).
  const RUNES = {
    a: 'ᚨ', b: 'ᛒ', c: 'ᚲ', d: 'ᛞ', e: 'ᛖ', f: 'ᚠ', g: 'ᚷ', h: 'ᚺ', i: 'ᛁ', j: 'ᛃ', k: 'ᚲ', l: 'ᛚ', m: 'ᛗ',
    n: 'ᚾ', o: 'ᛟ', p: 'ᛈ', q: 'ᚲ', r: 'ᚱ', s: 'ᛊ', t: 'ᛏ', u: 'ᚢ', v: 'ᚹ', w: 'ᚹ', x: 'ᚲᛊ', y: 'ᛁ', z: 'ᛉ',
  };
  function runes(text) {
    const s = String(text == null ? '' : text).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
    let out = '';
    for (let i = 0; i < s.length; i++) {
      const c = s[i];
      const two = s.slice(i, i + 2);
      if (two === 'th') {
        out += 'ᚦ';
        i++;
      } else if (two === 'ng') {
        out += 'ᛜ';
        i++;
      } else if (RUNES[c]) out += RUNES[c];
      else if (/\s/.test(c)) out += out.endsWith('᛫') ? '' : '᛫';
      else if (/[0-9]/.test(c)) out += c;
    }
    return out.replace(/^᛫+|᛫+$/g, '');
  }
  function ornament(text) {
    return `✧ ${text} ✧`;
  }
  /** Title / banner text in the current language (elf: ornaments). Dwarf runes are added by the page. */
  function title(text, lang) {
    lang = lang || current;
    return lang === 'elf' ? ornament(text) : text;
  }

  // ------------------------------------------------------------ current language

  function setLang(lang) {
    if (!isLang(lang)) lang = 'fr';
    const changed = lang !== current;
    current = lang;
    if (changed) for (const fn of listeners.slice()) {
      try {
        fn(lang);
      } catch (e) {
        if (typeof console !== 'undefined') console.error('[i18n]', e);
      }
    }
    return lang;
  }
  function getLang() {
    return current;
  }
  function onChange(fn) {
    listeners.push(fn);
  }

  const api = {
    LANGS, REAL, BY_CODE, dicts, register, lookup, has, isLang, detect, localeOf,
    t, tl, render, isMsg, num, date, time, pluralForm, entify, entifyWords, runes, ornament, title,
    setLang, getLang, onChange,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.LOTRI18N = api;
})(typeof window !== 'undefined' ? window : globalThis);
