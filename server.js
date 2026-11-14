'use strict';
/**
 * Carte de la Terre du Milieu — local server.
 *
 *   POST /event        raw Claude Code hook payload (JSON) -> state update
 *   POST /statusline   raw Claude Code status line payload (JSON) -> usage (limits, context, cost)
 *   GET  /stream       Server-Sent Events (snapshot then incremental events)
 *   GET  /state        JSON snapshot
 *   POST /demo/start   start demo mode
 *   POST /demo/stop    stop demo mode
 *   GET  /*            static files from public/
 *
 * Zero dependency, listens on 127.0.0.1 only.
 */
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { Store } = require('./lib/store');
const { Demo } = require('./lib/demo');
const { TranscriptReader } = require('./lib/transcripts');

const PORT = Number(process.env.PORT) || 4777;
const HOST = '127.0.0.1';
const PUBLIC_DIR = path.join(__dirname, 'public');
// LOTR_DATA_DIR lets the macOS app keep data out of its bundle (~/Library/Application Support/...).
const DATA_DIR = process.env.LOTR_DATA_DIR || path.join(__dirname, 'data');
const EVENTS_FILE = process.env.LOTR_EVENTS_FILE || path.join(DATA_DIR, 'events.jsonl');
const MAX_BODY = 20 * 1024 * 1024;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
};

const store = new Store({ file: EVENTS_FILE });
const demo = new Demo(store);
const clients = new Set();

store.loadUsageState();
const loaded = store.load();
if (loaded) console.log(`[lotr] ${loaded} événements rechargés depuis ${EVENTS_FILE}`);
// Token usage from the transcripts (only files under ~/.claude/projects, read incrementally).
store.attachTranscripts(new TranscriptReader({ onUsage: (id, delta, model, days) => store.addTokens(id, delta, model, days) }));

store.on('broadcast', (type, data) => {
  let msg;
  try {
    msg = `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
  } catch {
    return;
  }
  for (const res of clients) {
    try {
      res.write(msg);
    } catch {
      clients.delete(res);
    }
  }
});

// ------------------------------------------------------------ helpers

function send(res, status, body, type = 'application/json; charset=utf-8') {
  const payload = typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(payload);
}

function readBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    let size = 0;
    let tooLarge = false;
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) tooLarge = true;
      else chunks.push(c);
    });
    req.on('end', () => resolve({ tooLarge, text: tooLarge ? '' : Buffer.concat(chunks).toString('utf8') }));
    req.on('error', () => resolve({ tooLarge: false, text: '', error: true }));
  });
}

const ALLOWED_HOSTS = new Set([`127.0.0.1:${PORT}`, `localhost:${PORT}`, `[::1]:${PORT}`]);

function hostAllowed(req) {
  const h = req.headers.host;
  return !h || ALLOWED_HOSTS.has(h.toLowerCase());
}

function isJson(req) {
  return String(req.headers['content-type'] || '').toLowerCase().includes('application/json');
}

function serveStatic(req, res, pathname) {
  let rel;
  try {
    rel = decodeURIComponent(pathname);
  } catch {
    return send(res, 400, { error: 'bad path' });
  }
  if (rel === '/' || rel === '') rel = '/index.html';
  const file = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!file.startsWith(PUBLIC_DIR + path.sep)) return send(res, 403, { error: 'forbidden' });
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) return send(res, 404, 'Introuvable', 'text/plain; charset=utf-8');
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Content-Length': st.size,
      'Cache-Control': 'no-cache',
    });
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(file).on('error', () => res.destroy()).pipe(res);
  });
}

function openStream(req, res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write('retry: 2000\n\n');
  res.write(`event: snapshot\ndata: ${JSON.stringify(store.snapshot())}\n\n`);
  clients.add(res);
  const done = () => clients.delete(res);
  req.on('close', done);
  res.on('error', done);
}

// ------------------------------------------------------------ routes

async function handle(req, res) {
  if (!hostAllowed(req)) return send(res, 403, { error: 'host not allowed' });
  const url = new URL(req.url, `http://${HOST}:${PORT}`);
  const p = url.pathname;

  if (req.method === 'POST') {
    // Requiring application/json blocks cross-site "simple" form posts.
    if (!isJson(req)) return send(res, 415, { error: 'content-type must be application/json' });
    if (p === '/event') {
      const { tooLarge, text } = await readBody(req);
      if (tooLarge) return send(res, 413, { error: 'payload too large' });
      let raw;
      try {
        raw = JSON.parse(text);
      } catch {
        return send(res, 400, { error: 'invalid json' });
      }
      const hook = url.searchParams.get('hook') || req.headers['x-hook-event'] || undefined;
      try {
        store.ingest(raw, { hook: hook ? String(hook).replace(/[^A-Za-z]/g, '').slice(0, 40) : undefined });
      } catch (e) {
        console.warn('[lotr] event ignoré :', e && e.message);
        return send(res, 200, { ok: false });
      }
      return send(res, 200, { ok: true });
    }
    if (p === '/statusline') {
      const { tooLarge, text } = await readBody(req);
      if (tooLarge) return send(res, 413, { error: 'payload too large' });
      let raw;
      try {
        raw = JSON.parse(text);
      } catch {
        return send(res, 400, { error: 'invalid json' });
      }
      try {
        store.ingestStatusline(raw);
      } catch (e) {
        console.warn('[lotr] status line ignorée :', e && e.message);
        return send(res, 200, { ok: false });
      }
      return send(res, 200, { ok: true });
    }
    if (p === '/demo/start') {
      await readBody(req);
      demo.start();
      return send(res, 200, { demo: true });
    }
    if (p === '/demo/stop') {
      await readBody(req);
      demo.stop();
      return send(res, 200, { demo: false });
    }
    return send(res, 404, { error: 'not found' });
  }

  if (req.method === 'GET' || req.method === 'HEAD') {
    if (p === '/stream') return openStream(req, res);
    if (p === '/state') return send(res, 200, store.snapshot());
    if (p === '/health') return send(res, 200, { ok: true, demo: demo.running, agents: store.agents.size });
    return serveStatic(req, res, p);
  }

  return send(res, 405, { error: 'method not allowed' });
}

const server = http.createServer((req, res) => {
  handle(req, res).catch((e) => {
    console.warn('[lotr] erreur requête :', e && e.message);
    try {
      if (!res.headersSent) send(res, 500, { error: 'internal' });
      else res.end();
    } catch {
      /* ignore */
    }
  });
});

server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') {
    console.error(`[lotr] le port ${PORT} est déjà utilisé (PORT=xxxx pour en changer).`);
    process.exit(1);
  }
  console.error('[lotr] erreur serveur :', e.message);
});

// Keep-alive comments so proxies/browsers don't drop idle SSE connections.
setInterval(() => {
  for (const res of clients) {
    try {
      res.write(': ping\n\n');
    } catch {
      clients.delete(res);
    }
  }
}, 15000).unref();

// Inactive sessions -> done after 30 min, removed after 2 h.
setInterval(() => store.sweep(Date.now()), 30000).unref();
// Catch up on transcripts of live sessions even without hook events (throttled per session).
setInterval(() => store.pollTranscripts(), 15000).unref();

// Never crash on an unexpected error: this is a background companion tool.
process.on('uncaughtException', (e) => console.error('[lotr] exception non gérée :', e && e.stack));
process.on('unhandledRejection', (e) => console.error('[lotr] promesse rejetée :', e));

function shutdown() {
  demo.stop();
  for (const res of clients) {
    try {
      res.end();
    } catch {
      /* ignore */
    }
  }
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 500).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

// When spawned by the macOS app, exit if the app disappears (crash, force quit) instead of lingering.
const PARENT_PID = Number(process.env.LOTR_PARENT_PID) || 0;
if (PARENT_PID > 1) {
  setInterval(() => {
    try {
      process.kill(PARENT_PID, 0);
    } catch {
      shutdown();
    }
  }, 2000).unref();
}

server.listen(PORT, HOST, () => {
  console.log(`[lotr] Carte de la Terre du Milieu : http://${HOST}:${PORT}`);
  if (process.argv.includes('--demo') || process.env.DEMO === '1') {
    demo.start();
    console.log('[lotr] mode démo activé');
  }
});
