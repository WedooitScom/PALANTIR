'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Store, TERRITORIES } = require('../lib/store');
const { BUSY_DAY_TOOLS } = require('../lib/achievements');

function mkStore() {
  return new Store({ file: null });
}

function badges(s) {
  return s.chronicle.filter((e) => e.kind === 'badge').map((e) => e.badge);
}

const start = (s, id, extra = {}) => s.ingest({ session_id: id, cwd: '/p/' + id, hook_event_name: 'SessionStart', ...extra });
const five = (s, pct) => s.ingestStatusline({ rate_limits: { five_hour: { used_percentage: pct, resets_at: 2000000000 } } });

test('first_company: the very first session, once', () => {
  const s = mkStore();
  start(s, 'a');
  start(s, 'b');
  assert.deepEqual(badges(s), ['first_company']);
  const e = s.chronicle.find((x) => x.kind === 'badge');
  assert.equal(e.icon, '🏅');
  assert.equal(e.key, 'log.badge');
  assert.match(e.text, /Première compagnie/);
  assert.deepEqual(s.snapshot().achievements.map((a) => a.key), ['first_company']);
});

test('demo sessions never unlock anything', () => {
  const s = mkStore();
  s.ingest({ session_id: 'd', cwd: '/p/d', hook_event_name: 'SessionStart' }, { demo: true });
  assert.deepEqual(badges(s), []);
});

test('all_realms: every territory hosted a company at least once', () => {
  const s = mkStore();
  for (let i = 0; i < TERRITORIES.length - 1; i++) start(s, 's' + i);
  assert.ok(!badges(s).includes('all_realms'));
  start(s, 'last');
  assert.ok(badges(s).includes('all_realms'));
  start(s, 'again');
  assert.equal(badges(s).filter((b) => b === 'all_realms').length, 1);
});

test('storm_survived: the 5 h limit drops after reaching 80 %', () => {
  const s = mkStore();
  five(s, 70);
  five(s, 60);
  assert.deepEqual(badges(s), []);
  five(s, 85);
  assert.deepEqual(badges(s), []);
  s.ingestStatusline({ rate_limits: { five_hour: { used_percentage: 5, resets_at: 2000018000 } } });
  assert.deepEqual(badges(s), ['storm_survived']);
  five(s, 90);
  s.ingestStatusline({ rate_limits: { five_hour: { used_percentage: 2, resets_at: 2000036000 } } });
  assert.deepEqual(badges(s), ['storm_survived']);
});

test('busy_day: 300 PostToolUse on one calendar day', () => {
  const s = mkStore();
  const post = () => s.ingest({ session_id: 's1', cwd: '/p/x', hook_event_name: 'PostToolUse', tool_name: 'Read', tool_input: { file_path: '/p/x/a' } });
  for (let i = 0; i < BUSY_DAY_TOOLS - 1; i++) post();
  assert.ok(!badges(s).includes('busy_day'));
  post();
  post();
  assert.equal(badges(s).filter((b) => b === 'busy_day').length, 1);
});

test('busy_day: the counter restarts on a new calendar day', () => {
  const s = mkStore();
  for (let i = 0; i < BUSY_DAY_TOOLS - 1; i++) assert.deepEqual(s.ach.onToolDone('2026-11-20', 0), []);
  assert.deepEqual(s.ach.onToolDone('2026-11-21', 0), []);
  for (let i = 0; i < BUSY_DAY_TOOLS - 2; i++) s.ach.onToolDone('2026-11-21', 0);
  assert.deepEqual(s.ach.onToolDone('2026-11-21', 0).map((d) => d.key), ['busy_day']);
});

test('first_eagle: the first SendMessage between agents, once', () => {
  const s = mkStore();
  start(s, 's1');
  const send = () => s.ingest({ session_id: 's1', cwd: '/p/s1', hook_event_name: 'PreToolUse', tool_name: 'SendMessage', tool_input: { to: 'x', message: 'hi' } });
  send();
  send();
  assert.equal(badges(s).filter((b) => b === 'first_eagle').length, 1);
});

test('unlocked deeds survive a restart: the replay does not announce them again', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lotr-ach-'));
  const file = path.join(dir, 'events.jsonl');
  const s1 = new Store({ file });
  start(s1, 's1');
  s1.ingest({ session_id: 's1', cwd: '/p/s1', hook_event_name: 'PreToolUse', tool_name: 'SendMessage', tool_input: { to: 'x', message: 'hi' } });
  assert.deepEqual(badges(s1), ['first_company', 'first_eagle']);
  assert.ok(fs.existsSync(path.join(dir, 'achievements.json')));
  const s2 = new Store({ file });
  s2.loadAchievements();
  assert.ok(s2.load() > 0);
  start(s2, 's2');
  assert.deepEqual(badges(s2), []);
  assert.deepEqual(s2.snapshot().achievements.map((a) => a.key), ['first_company', 'first_eagle']);
  fs.rmSync(dir, { recursive: true, force: true });
});
