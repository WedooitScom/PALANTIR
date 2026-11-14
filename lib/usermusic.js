'use strict';
/**
 * "Ta musique": the server serves ONE local audio file chosen in the macOS app (GET /user-music).
 * The path never comes from a URL: only from LOTR_USER_MUSIC (set by the app at launch) or from an
 * authenticated local POST (token LOTR_APP_TOKEN shared with the app). Nothing is copied anywhere.
 */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const MUSIC_MIME = {
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.wav': 'audio/wav',
  '.aif': 'audio/aiff',
  '.aiff': 'audio/aiff',
};

/** Returns { path, size, type } for an acceptable file, or null. */
function validateMusicPath(p) {
  if (typeof p !== 'string' || !p || p.length > 4096 || p.includes('\0') || !path.isAbsolute(p)) return null;
  let real;
  try {
    real = fs.realpathSync(p);
  } catch {
    return null;
  }
  const type = MUSIC_MIME[path.extname(real).toLowerCase()];
  if (!type) return null;
  let st;
  try {
    st = fs.statSync(real);
  } catch {
    return null;
  }
  if (!st.isFile()) return null;
  return { path: real, size: st.size, type };
}

/**
 * Single "bytes=" range -> { start, end } (inclusive), null when absent/unsupported (serve the whole
 * file), or 'invalid' (416).
 */
function parseRange(header, size) {
  if (!header) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(String(header).trim());
  if (!m) return null; // multi-range or other units: ignore, send the whole file
  let start;
  let end;
  if (m[1] === '' && m[2] === '') return 'invalid';
  if (m[1] === '') {
    const n = Number(m[2]);
    if (n === 0) return 'invalid';
    start = Math.max(0, size - n);
    end = size - 1;
  } else {
    start = Number(m[1]);
    end = m[2] === '' ? size - 1 : Math.min(Number(m[2]), size - 1);
  }
  if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || start >= size) return 'invalid';
  return { start, end };
}

function tokenOk(expected, given) {
  if (typeof expected !== 'string' || expected.length < 16 || typeof given !== 'string') return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(given);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

class UserMusic {
  constructor(initialPath, token) {
    this.token = token || '';
    this.file = null;
    this.version = 0;
    if (initialPath) this.set(initialPath);
  }

  /** Registers a path (or clears with null). Returns false if the file is not acceptable. */
  set(p) {
    if (p == null || p === '') {
      if (this.file) this.version++;
      this.file = null;
      return true;
    }
    const v = validateMusicPath(p);
    if (!v) return false;
    this.file = v.path;
    this.version++;
    return true;
  }

  info() {
    const v = this.file ? validateMusicPath(this.file) : null;
    return { available: !!v, name: v ? path.basename(v.path) : null, version: this.version };
  }

  /** GET/HEAD /user-music */
  serve(req, res) {
    const v = this.file ? validateMusicPath(this.file) : null;
    if (!v) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
      return res.end('Aucune musique choisie');
    }
    const base = { 'Content-Type': v.type, 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-store' };
    const r = parseRange(req.headers.range, v.size);
    if (r === 'invalid') {
      res.writeHead(416, { ...base, 'Content-Range': `bytes */${v.size}` });
      return res.end();
    }
    const start = r ? r.start : 0;
    const end = r ? r.end : v.size - 1;
    const headers = { ...base, 'Content-Length': v.size ? end - start + 1 : 0 };
    if (r) headers['Content-Range'] = `bytes ${start}-${end}/${v.size}`;
    res.writeHead(r ? 206 : 200, headers);
    if (req.method === 'HEAD' || !v.size) return res.end();
    fs.createReadStream(v.path, { start, end }).on('error', () => res.destroy()).pipe(res);
  }
}

module.exports = { UserMusic, validateMusicPath, parseRange, tokenOk, MUSIC_MIME };
