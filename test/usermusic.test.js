'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { UserMusic, validateMusicPath, parseRange, tokenOk } = require('../lib/usermusic');
const { Store } = require('../lib/store');

const tmpDirs = [];
test.after(() => {
  for (const d of tmpDirs) fs.rmSync(d, { recursive: true, force: true });
});

function tmpFile(name, bytes) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lotr-music-'));
  tmpDirs.push(dir);
  const f = path.join(dir, name);
  fs.writeFileSync(f, Buffer.from(Array.from({ length: bytes }, (_, i) => i % 256)));
  return f;
}

test('parseRange: single ranges, suffix, open end, invalid', () => {
  assert.equal(parseRange(undefined, 100), null);
  assert.deepEqual(parseRange('bytes=0-9', 100), { start: 0, end: 9 });
  assert.deepEqual(parseRange('bytes=90-', 100), { start: 90, end: 99 });
  assert.deepEqual(parseRange('bytes=-10', 100), { start: 90, end: 99 });
  assert.deepEqual(parseRange('bytes=50-500', 100), { start: 50, end: 99 });
  assert.equal(parseRange('bytes=100-', 100), 'invalid');
  assert.equal(parseRange('bytes=9-2', 100), 'invalid');
  assert.equal(parseRange('bytes=0-1,5-6', 100), null); // multi-range: whole file
});

test('validateMusicPath: only absolute paths to existing audio files', () => {
  const f = tmpFile('piste.mp3', 10);
  assert.equal(validateMusicPath(f).type, 'audio/mpeg');
  assert.equal(validateMusicPath('piste.mp3'), null);
  assert.equal(validateMusicPath(path.dirname(f)), null);
  assert.equal(validateMusicPath(tmpFile('notes.txt', 10)), null);
  assert.equal(validateMusicPath(f + '.absent.mp3'), null);
  assert.equal(validateMusicPath(42), null);
});

test('tokenOk: constant-time compare, refuses short or missing tokens', () => {
  const t = 'abcdefghijklmnopqrstuvwxyz';
  assert.equal(tokenOk(t, t), true);
  assert.equal(tokenOk(t, t + 'x'), false);
  assert.equal(tokenOk(t, undefined), false);
  assert.equal(tokenOk('', ''), false);
  assert.equal(tokenOk('short', 'short'), false);
});

test('UserMusic serves the registered file with Range support, 404 without one', async () => {
  const f = tmpFile('air.m4a', 1000);
  const m = new UserMusic(null, 'x'.repeat(20));
  const srv = http.createServer((req, res) => m.serve(req, res));
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const port = srv.address().port;
  const get = (headers = {}) => new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port, path: '/user-music', headers }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
    }).on('error', reject);
  });
  try {
    assert.equal((await get()).status, 404);
    assert.equal(m.info().available, false);
    assert.equal(m.set(f), true);
    assert.deepEqual(m.info(), { available: true, name: 'air.m4a', version: 1 });
    const all = await get();
    assert.equal(all.status, 200);
    assert.equal(all.body.length, 1000);
    assert.equal(all.headers['accept-ranges'], 'bytes');
    assert.equal(all.headers['content-type'], 'audio/mp4');
    const part = await get({ Range: 'bytes=10-19' });
    assert.equal(part.status, 206);
    assert.equal(part.headers['content-range'], 'bytes 10-19/1000');
    assert.deepEqual([...part.body], [10, 11, 12, 13, 14, 15, 16, 17, 18, 19]);
    assert.equal((await get({ Range: 'bytes=5000-' })).status, 416);
    assert.equal(m.set('/etc/passwd'), false); // not an audio file: refused, previous file kept
    assert.equal(m.info().name, 'air.m4a');
    assert.equal(m.set(null), true);
    assert.equal((await get()).status, 404);
  } finally {
    srv.close();
  }
});

test('log entries carry what the front needs for sounds (tool name, usage level, reset)', () => {
  const s = new Store({ file: null });
  s.ingest({ session_id: 's1', cwd: '/x/LOTRAgent', hook_event_name: 'PreToolUse', tool_name: 'Write', tool_input: { file_path: '/x/LOTRAgent/a.js' } });
  assert.equal(s.chronicle.at(-1).tool, 'Write');
  const tick = (pct, resets_at) => s.ingestStatusline({ rate_limits: { five_hour: { used_percentage: pct, resets_at } } });
  tick(82, 2000000000);
  assert.equal(s.chronicle.at(-1).level, 80);
  assert.equal(s.chronicle.at(-1).limit, 'five');
  tick(3, 2000018000);
  assert.equal(s.chronicle.at(-1).reset, true);
});
