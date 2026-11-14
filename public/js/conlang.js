/* Invented languages (elf, dwarf, ent): French text -> invented words, deterministic.
 *
 * Each French word goes through a hand-written lexicon (conlang-data.js), else through a generator:
 * FNV-1a hash of the normalized word -> syllables of the language (length grows with the source
 * word), retried while the result hits the blacklist. Same word -> same invented word everywhere.
 * Kept as they are: {placeholders}, param sentinels, protected terms (product names, commands),
 * technical chunks (server.js, a@b, ~/x), words with digits, acronyms (API, OFF) and camelCase
 * names (macOS), one-letter units (h, j, s), punctuation, numbers and emoji. Case is preserved.
 *
 * The macOS app ports this algorithm exactly (macos/Sources/Conlang.swift, same data file): keep
 * both in sync (test/conlang.test.js compares them when swiftc is available).
 */
(function (root) {
  'use strict';

  const DATA = typeof module !== 'undefined' && module.exports ? require('./conlang-data') : root.LOTRConlangData;
  const LANGS = (DATA && DATA.langs) || {};
  const BL = (DATA && DATA.blacklist) || { words: [], suffixes: [], contains: [] };
  const BL_WORDS = new Set(BL.words);
  const BL_LONG = BL.words.filter((w) => w.length >= 4);
  const KEEP = ((DATA && DATA.keep) || []).slice().sort((a, b) => b.length - a.length);

  const RE_L = /\p{L}/u;
  const RE_LU = /\p{Lu}/u;
  const RE_LL = /\p{Ll}/u;
  const RE_N = /\p{N}/u;
  const RE_WORD = /[\p{L}\p{M}\p{N}]/u;
  const RE_SPACE = /^[ \t\n\r   ]+$/;
  const RE_TECH = /[\p{L}\p{N}][._@~][\p{L}\p{N}]/u;
  const APOS = new Set(["'", '’']);

  const lexCache = {};
  function lexicon(lang) {
    if (lexCache[lang]) return lexCache[lang];
    const m = new Map();
    const lex = (LANGS[lang] && LANGS[lang].lex) || {};
    for (const [k, v] of Object.entries(lex)) for (const fr of k.split('|')) m.set(fr, v);
    lexCache[lang] = m;
    return m;
  }

  function fnv(s) {
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  /** Lowercase ASCII letters only: accents removed, œ -> oe, æ -> ae, ø -> o. */
  function norm(s) {
    return String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/œ/g, 'oe').replace(/æ/g, 'ae').replace(/ø/g, 'o').replace(/[^a-z]/g, '');
  }

  /** A forbidden form: blacklisted word (whole, or inside for 4+ letters), suffix or digraph. */
  function isBanned(w) {
    const b = norm(w);
    if (!b) return false;
    if (BL_WORDS.has(b)) return true;
    for (const x of BL_LONG) if (b.includes(x)) return true;
    for (const x of BL.suffixes) if (b.endsWith(x)) return true;
    for (const x of BL.contains) if (b.includes(x)) return true;
    return false;
  }

  const genCache = {};
  /** Invented word for a lowercase French word (not in the lexicon). */
  function gen(lang, lw) {
    const cache = genCache[lang] || (genCache[lang] = new Map());
    if (cache.has(lw)) return cache.get(lw);
    const n = norm(lw);
    const cfg = LANGS[lang] && LANGS[lang].gen;
    if (!n || !cfg) return lw;
    const syl = Math.min(cfg.max, Math.max(cfg.min, Math.floor((n.length + cfg.add) / cfg.div)));
    let word = lw;
    for (let attempt = 0; attempt < 10; attempt++) {
      let s = fnv(lang + '|' + attempt + '|' + n);
      const rnd = (k) => {
        s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
        return (s >>> 8) % k;
      };
      const parts = [];
      for (let i = 0; i < syl; i++) {
        const on = (i === 0 ? cfg.onsetFirst : cfg.onset);
        const onset = on[rnd(on.length)];
        const nucleus = cfg.nucleus[rnd(cfg.nucleus.length)];
        const co = i === syl - 1 ? cfg.codaEnd : cfg.coda;
        parts.push(onset + nucleus + co[rnd(co.length)]);
      }
      if (cfg.redouble && syl >= 3) {
        const j = rnd(syl - 1);
        parts.splice(j + 1, 0, parts[j]);
      }
      word = parts.join('');
      if (!isBanned(word)) break;
    }
    cache.set(lw, word);
    return word;
  }

  const cpLen = (s) => Array.from(s).length;
  const isUpper = (w) => w === w.toUpperCase() && w !== w.toLowerCase();
  function capFirst(s) {
    const cs = Array.from(s);
    return cs.length ? cs[0].toUpperCase() + cs.slice(1).join('') : s;
  }
  function applyCase(src, base) {
    if (isUpper(src) && cpLen(src) > 1) return base.toUpperCase();
    const first = Array.from(src)[0];
    return first && RE_LU.test(first) ? capFirst(base) : base;
  }

  /** One French word (letters, marks, digits). hasLower: the whole text has lowercase letters. */
  function word(lang, w, hasLower) {
    if (RE_N.test(w)) return w;
    const lw = w.toLowerCase();
    const len = cpLen(w);
    if (hasLower && len >= 2 && len <= 4 && isUpper(w)) return w; // acronym (API, ON), not a banner word
    const lex = lexicon(lang);
    if (lex.has(lw)) return applyCase(w, lex.get(lw));
    if (len === 1) return w;
    if (!isUpper(w) && Array.from(w).slice(1).some((c) => RE_LU.test(c))) return w; // macOS, iTerm
    return applyCase(w, gen(lang, lw));
  }

  /** Words of a chunk without spaces, with French elisions (l', d', qu') and compounds (aujourd'hui). */
  function chunkWords(lang, chunk, hasLower) {
    const cs = Array.from(chunk);
    const lex = lexicon(lang);
    let out = '';
    let i = 0;
    while (i < cs.length) {
      if (!RE_L.test(cs[i])) {
        out += cs[i];
        i++;
        continue;
      }
      let j = i;
      while (j < cs.length && RE_WORD.test(cs[j])) j++;
      const w = cs.slice(i, j).join('');
      if (j < cs.length && APOS.has(cs[j])) {
        if (j + 1 < cs.length && RE_L.test(cs[j + 1])) {
          let k = j + 1;
          while (k < cs.length && RE_WORD.test(cs[k])) k++;
          const key = w.toLowerCase() + "'" + cs.slice(j + 1, k).join('').toLowerCase();
          if (lex.has(key)) {
            out += applyCase(w, lex.get(key));
            i = k;
            continue;
          }
        }
        const el = w.toLowerCase() + "'";
        if (lex.has(el)) {
          out += applyCase(w, lex.get(el)) + ' ';
          i = j + 1;
          continue;
        }
      }
      out += word(lang, w, hasLower);
      i = j;
    }
    return out;
  }

  function plain(lang, s, hasLower) {
    let out = '';
    for (const part of s.split(/([ \t\n\r   ]+)/)) {
      if (!part) continue;
      if (RE_SPACE.test(part) || RE_TECH.test(part) || part.includes('://')) out += part;
      else out += chunkWords(lang, part, hasLower);
    }
    return out;
  }

  const isWordAt = (s, i) => i >= 0 && i < s.length && RE_WORD.test(s[i]);

  /** French text -> invented language. Placeholders {x} and sentinels \u0001n\u0002 are kept. */
  function translate(lang, text) {
    if (text == null) return '';
    text = String(text);
    if (!Object.prototype.hasOwnProperty.call(LANGS, lang)) return text;
    const hasLower = RE_LL.test(text.replace(/\{\w+\}/g, ''));
    let out = '';
    let buf = '';
    let i = 0;
    const flush = () => {
      if (buf) out += plain(lang, buf, hasLower);
      buf = '';
    };
    while (i < text.length) {
      const c = text[i];
      if (c === '{') {
        const m = /^\{\w+\}/.exec(text.slice(i));
        if (m) {
          flush();
          out += m[0];
          i += m[0].length;
          continue;
        }
      }
      if (c === '\u0001') {
        const end = text.indexOf('\u0002', i);
        if (end > i) {
          flush();
          out += text.slice(i, end + 1);
          i = end + 1;
          continue;
        }
      }
      let kept = null;
      if (!isWordAt(text, i - 1)) {
        for (const k of KEEP) {
          if (text.startsWith(k, i) && !isWordAt(text, i + k.length)) {
            kept = k;
            break;
          }
        }
      }
      if (kept) {
        flush();
        out += kept;
        i += kept.length;
        continue;
      }
      buf += c;
      i++;
    }
    flush();
    return out;
  }

  function name(lang) {
    return (LANGS[lang] && LANGS[lang].name) || '';
  }

  const api = { translate, gen, norm, isBanned, lexicon, name, langs: Object.keys(LANGS), DATA };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.LOTRConlang = api;
})(typeof window !== 'undefined' ? window : globalThis);
