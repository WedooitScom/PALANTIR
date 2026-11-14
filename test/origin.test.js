'use strict';
// Session origin ("go to this session"): validation on the server, and what the hook script sends.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { Store, sanitizeOrigin, parseOriginHeader, sanitizeEvent } = require('../lib/store');

const ROOT = path.resolve(__dirname, '..');
const HOOK = path.join(ROOT, 'hooks', 'send-event.sh');

const SECRET_EMAIL = 'frodo.secret@example.invalid';
const SECRET_TOKEN = 'sk-ant-oat01-FAKE-TOKEN-must-never-leave-0123456789';

test('sanitizeOrigin keeps valid whitelisted fields only', () => {
  const o = sanitizeOrigin({
    entrypoint: 'cli',
    hostSessionId: 'local_00000000-1111-2222-3333-444444444444',
    termProgram: 'Apple_Terminal',
    bundleId: 'com.apple.Terminal',
    itermSessionId: 'w0t1p0:6C3E1F6B-1111-2222-3333-444455556666',
    tty: '/dev/ttys012',
    claudePid: '4242',
    email: SECRET_EMAIL,
    token: SECRET_TOKEN,
  });
  assert.deepEqual(o, {
    entrypoint: 'cli',
    hostSessionId: 'local_00000000-1111-2222-3333-444444444444',
    termProgram: 'Apple_Terminal',
    bundleId: 'com.apple.Terminal',
    itermSessionId: 'w0t1p0:6C3E1F6B-1111-2222-3333-444455556666',
    tty: '/dev/ttys012',
    claudePid: 4242,
  });
});

test('sanitizeOrigin rejects malformed values', () => {
  const bad = {
    entrypoint: 'CLI; rm -rf ~',
    hostSessionId: 'local_abc"&open -a Calculator',
    termProgram: 'Apple Terminal',
    bundleId: 'com.apple.Terminal\nX: y',
    itermSessionId: 'w0t0p0:$(id)',
    tty: '/dev/ttys003/../../etc/passwd',
    claudePid: '12; kill 1',
  };
  assert.equal(sanitizeOrigin(bad), null);
  assert.equal(sanitizeOrigin({ hostSessionId: 'remote_abc' }), null);
  assert.equal(sanitizeOrigin({ hostSessionId: 'local_' + 'a'.repeat(65) }), null);
  assert.equal(sanitizeOrigin({ hostSessionId: 'local_a_b' }), null);
  assert.equal(sanitizeOrigin({ tty: '/dev/tty003' }), null);
  assert.equal(sanitizeOrigin({ tty: '/dev/ttys12345' }), null);
  assert.equal(sanitizeOrigin({ claudePid: '1' }), null);
  assert.equal(sanitizeOrigin({ claudePid: 12.5 }), null);
  assert.equal(sanitizeOrigin({ entrypoint: ['cli'] }), null);
  assert.equal(sanitizeOrigin('entrypoint=cli'), null);
  assert.equal(sanitizeOrigin(null), null);
  // Partially valid: only the good fields survive.
  assert.deepEqual(sanitizeOrigin({ entrypoint: 'cli', tty: 'ttys003' }), { entrypoint: 'cli' });
});

test('parseOriginHeader parses k=v&k=v and ignores unknown or repeated keys', () => {
  assert.deepEqual(parseOriginHeader('entrypoint=cli&tty=/dev/ttys004&tty=/dev/ttys999&evil=1&claudePid=77'), {
    entrypoint: 'cli',
    tty: '/dev/ttys004',
    claudePid: 77,
  });
  assert.equal(parseOriginHeader('x'.repeat(2000)), null);
  assert.equal(parseOriginHeader(undefined), null);
  assert.equal(parseOriginHeader('tty=/dev/ttys1%0a'), null);
});

test('the session keeps the last non-empty origin; subagent events do not erase it', () => {
  const s = new Store({ file: null });
  s.ingest({ session_id: 'o1', cwd: '/p/Shire', hook_event_name: 'SessionStart', origin: { entrypoint: 'cli', tty: '/dev/ttys001', claudePid: 100 } });
  assert.deepEqual(s.agents.get('o1').origin, { entrypoint: 'cli', tty: '/dev/ttys001', claudePid: 100 });
  s.ingest({ session_id: 'o1', hook_event_name: 'Stop' });
  assert.deepEqual(s.agents.get('o1').origin, { entrypoint: 'cli', tty: '/dev/ttys001', claudePid: 100 });
  s.ingest({ session_id: 'o1', hook_event_name: 'UserPromptSubmit', prompt: 'x', origin: { entrypoint: 'cli', tty: 'bad' } });
  assert.deepEqual(s.agents.get('o1').origin, { entrypoint: 'cli' });
  // Persisted events carry the sanitized origin and are re-validated on replay.
  const ev = sanitizeEvent({ session_id: 'o2', origin: { tty: '/dev/ttys002', junk: 'x' } }, 'Stop', { replay: true });
  assert.deepEqual(ev.origin, { tty: '/dev/ttys002' });
  assert.ok(s.snapshot().agents.find((a) => a.id === 'o1').origin);
});

// ------------------------------------------------------------ hook script

function runHook(port, extraEnv, stdin) {
  return new Promise((resolve) => {
    const env = {
      PATH: process.env.PATH,
      HOME: os.tmpdir(),
      LOTR_MAP_PORT: String(port),
      ...extraEnv,
    };
    const p = spawn('/bin/sh', [HOOK, 'Stop'], { env, stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '';
    p.stdout.on('data', (d) => (out += d));
    p.stderr.on('data', (d) => (out += d));
    p.on('close', (code) => resolve({ code, out }));
    p.stdin.end(stdin);
  });
}

const FAKE_ENV = {
  CLAUDE_CODE_ENTRYPOINT: 'cli',
  CLAUDE_CODE_HOST_SESSION_ID: 'local_0f1e2d3c-aaaa-bbbb-cccc-0123456789ab',
  TERM_PROGRAM: 'Apple_Terminal',
  __CFBundleIdentifier: 'com.apple.Terminal',
  ITERM_SESSION_ID: 'w0t0p0:ABCDEF01-2345',
  CLAUDE_PID: '31337',
  // Must never be sent.
  CLAUDE_CODE_USER_EMAIL: SECRET_EMAIL,
  CLAUDE_CODE_OAUTH_TOKEN: SECRET_TOKEN,
  CLAUDE_CODE_MESSAGING_TOKEN: SECRET_TOKEN,
  CLAUDE_CODE_ACCOUNT_UUID: '11111111-2222-3333-4444-555555555555',
  ANTHROPIC_API_KEY: SECRET_TOKEN,
};

test('the hook sends only whitelisted origin fields (no e-mail, token or account id)', async () => {
  const captured = [];
  const srv = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      captured.push({ url: req.url, rawHeaders: req.rawHeaders, headers: req.headers, body: Buffer.concat(chunks).toString('utf8') });
      res.end('{"ok":true}');
    });
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const port = srv.address().port;
  try {
    const payload = JSON.stringify({ session_id: 'abc', hook_event_name: 'Stop' });
    const r = await runHook(port, FAKE_ENV, payload);
    assert.equal(r.code, 0);
    assert.equal(r.out, '', 'the hook must stay silent');
    assert.equal(captured.length, 1);
    const c = captured[0];
    assert.equal(c.url, '/event?hook=Stop');
    assert.equal(c.body, payload, 'the payload is forwarded untouched');
    const origin = parseOriginHeader(c.headers['x-lotr-origin']);
    assert.deepEqual(Object.keys(origin).sort(), ['bundleId', 'claudePid', 'entrypoint', 'hostSessionId', 'itermSessionId', 'termProgram']);
    assert.equal(origin.hostSessionId, FAKE_ENV.CLAUDE_CODE_HOST_SESSION_ID);
    assert.equal(origin.claudePid, 31337);
    // The header holds exactly the whitelisted keys, nothing else.
    const keys = c.headers['x-lotr-origin'].split('&').map((kv) => kv.split('=')[0]);
    for (const k of keys) assert.ok(['entrypoint', 'hostSessionId', 'termProgram', 'bundleId', 'itermSessionId', 'tty', 'claudePid'].includes(k), k);
    const everything = JSON.stringify(c);
    for (const secret of [SECRET_EMAIL, SECRET_TOKEN, FAKE_ENV.CLAUDE_CODE_ACCOUNT_UUID, 'frodo']) {
      assert.ok(!everything.includes(secret), `leaked: ${secret}`);
    }

    // Malformed values are not sent at all.
    captured.length = 0;
    const r2 = await runHook(port, {
      CLAUDE_CODE_ENTRYPOINT: 'cli\r\nX-Evil: 1',
      CLAUDE_CODE_HOST_SESSION_ID: 'local_abc&tty=/dev/ttys1',
      TERM_PROGRAM: 'a b',
      CLAUDE_PID: '12x',
      CLAUDE_CODE_USER_EMAIL: SECRET_EMAIL,
    }, '{}');
    assert.equal(r2.code, 0);
    assert.equal(captured.length, 1);
    const h = captured[0].headers['x-lotr-origin'];
    assert.ok(h === undefined || !/evil|abc|a b|12x/i.test(h), String(h));
    assert.equal(captured[0].headers['x-evil'], undefined);
    assert.ok(!JSON.stringify(captured[0]).includes(SECRET_EMAIL));
  } finally {
    srv.close();
  }
});

test('the hook exits 0 silently when the server is down', async () => {
  const port = await freePort();
  const r = await runHook(port, FAKE_ENV, '{"session_id":"x"}');
  assert.equal(r.code, 0);
  assert.equal(r.out, '');
});

function freePort() {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.listen(0, '127.0.0.1', () => {
      const p = s.address().port;
      s.close(() => resolve(p));
    });
  });
}

test('end to end: hook -> server.js -> /state exposes the validated origin', async () => {
  const port = await freePort();
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lotr-origin-'));
  const srv = spawn(process.execPath, [path.join(ROOT, 'server.js')], {
    env: { ...process.env, PORT: String(port), LOTR_DATA_DIR: dataDir, LOTR_PARENT_PID: '', DEMO: '' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  try {
    await new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('server did not start')), 5000);
      srv.stdout.on('data', (d) => {
        if (String(d).includes('Carte de la Terre du Milieu')) {
          clearTimeout(t);
          resolve();
        }
      });
    });
    const r = await runHook(port, FAKE_ENV, JSON.stringify({ session_id: 'e2e-session', cwd: '/tmp/Comte', hook_event_name: 'Stop' }));
    assert.equal(r.code, 0);
    const state = await (await fetch(`http://127.0.0.1:${port}/state`)).json();
    const a = state.agents.find((x) => x.id === 'e2e-session');
    assert.ok(a, 'session created');
    assert.equal(a.origin.entrypoint, 'cli');
    assert.equal(a.origin.claudePid, 31337);
    assert.equal(a.origin.hostSessionId, FAKE_ENV.CLAUDE_CODE_HOST_SESSION_ID);
    assert.ok(!JSON.stringify(state).includes(SECRET_EMAIL));
    const persisted = fs.readFileSync(path.join(dataDir, 'events.jsonl'), 'utf8');
    assert.ok(persisted.includes('"origin"'));
    assert.ok(!persisted.includes(SECRET_EMAIL) && !persisted.includes(SECRET_TOKEN));
  } finally {
    srv.kill('SIGTERM');
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});
