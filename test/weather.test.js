'use strict';
// Test outcomes of Bash test commands (rain on the map) — server side.
const test = require('node:test');
const assert = require('node:assert/strict');
const { Store, sanitizeEvent, RAIN_MS } = require('../lib/store');

const mkStore = () => new Store({ file: null });
const bash = (command, extra) => ({ session_id: 's1', cwd: '/p/AFT', tool_name: 'Bash', tool_use_id: 'tu' + Math.random(), tool_input: { command }, ...extra });

test('PostToolUseFailure on a test command makes it rain for RAIN_MS, without keeping the error text', () => {
  const s = mkStore();
  const ev = s.ingest(bash('npm test', { hook_event_name: 'PostToolUseFailure', error: 'Exit code 1\nAssertionError: secret stuff', is_interrupt: false }));
  assert.deepEqual(ev.tool_response, { error: true });
  assert.ok(!JSON.stringify(ev).includes('secret'));
  const t = s.agents.get('s1').tests;
  assert.equal(t.failed, 1);
  assert.equal(t.passed, 0);
  assert.equal(t.rainUntil, ev.ts + RAIN_MS);
  assert.equal(RAIN_MS, 60000);
  const log = s.chronicle.at(-1);
  assert.equal(log.kind, 'testFail');
  assert.equal(log.key, 'log.testFail');
});

test('a passing test run stops the rain; a pass without prior rain logs nothing', () => {
  const s = mkStore();
  s.ingest(bash('pytest -q', { hook_event_name: 'PostToolUse', tool_response: { stdout: '12 passed in 0.4s', stderr: '', interrupted: false, isImage: false } }));
  let t = s.agents.get('s1').tests;
  assert.equal(t.passed, 1);
  assert.equal(t.rainUntil, null);
  assert.notEqual(s.chronicle.at(-1) && s.chronicle.at(-1).kind, 'testPass');

  s.ingest(bash('pytest -q', { hook_event_name: 'PostToolUseFailure', error: 'Exit code 1' }));
  assert.ok(s.agents.get('s1').tests.rainUntil > 0);
  s.ingest(bash('pytest -q', { hook_event_name: 'PostToolUse', tool_response: { stdout: '12 passed', stderr: '', interrupted: false } }));
  t = s.agents.get('s1').tests;
  assert.equal(t.rainUntil, null);
  assert.equal(t.failed, 1);
  assert.equal(t.passed, 2);
  assert.equal(s.chronicle.at(-1).kind, 'testPass');
});

test('exit code / test summary in a PostToolUse response count as a failure; interrupted runs are ignored', () => {
  const s = mkStore();
  s.ingest(bash('npx vitest run', { hook_event_name: 'PostToolUse', tool_response: { stdout: 'Tests  2 failed | 10 passed', stderr: '' } }));
  assert.equal(s.agents.get('s1').tests.failed, 1);
  s.ingest(bash('go test ./...', { hook_event_name: 'PostToolUse', tool_response: { stdout: '', exitCode: 2 } }));
  assert.equal(s.agents.get('s1').tests.failed, 2);
  s.ingest(bash('node --test', { hook_event_name: 'PostToolUse', tool_response: { stdout: '# pass 58\n# fail 0\n', stderr: '' } }));
  assert.equal(s.agents.get('s1').tests.passed, 1);
  s.ingest(bash('npm test', { hook_event_name: 'PostToolUse', tool_response: { stdout: '', stderr: '', interrupted: true } }));
  s.ingest(bash('npm test', { hook_event_name: 'PostToolUseFailure', error: 'Interrupted', is_interrupt: true }));
  const t = s.agents.get('s1').tests;
  assert.equal(t.failed, 2);
  assert.equal(t.passed, 1);
});

test('non-test commands and other tools never touch the weather', () => {
  const s = mkStore();
  s.ingest(bash('git status', { hook_event_name: 'PostToolUseFailure', error: 'fatal' }));
  s.ingest(bash('npm run build', { hook_event_name: 'PostToolUse', tool_response: { stdout: '1 failed' } }));
  s.ingest({ session_id: 's1', hook_event_name: 'PostToolUseFailure', tool_name: 'Read', tool_input: { file_path: '/p/tests/a.js' }, error: 'no such file' });
  assert.equal(s.agents.get('s1').tests, null);
});

test('a subagent failing the tests makes it rain on its session', () => {
  const s = mkStore();
  s.ingest({ session_id: 's1', cwd: '/p/AFT', hook_event_name: 'PreToolUse', tool_name: 'Agent', tool_use_id: 'tuA', tool_input: { subagent_type: 'implementer', description: 'x', prompt: 'y' } });
  s.ingest(bash('npm test', { hook_event_name: 'PostToolUseFailure', agent_id: 'ag1', agent_type: 'implementer', error: 'Exit code 1' }));
  assert.equal(s.agents.get('s1').tests.failed, 1);
  assert.match(s.chronicle.at(-1).text, /\(implementer\)/);
});

test('Bash responses keep only booleans and survive a replay', () => {
  const ev = sanitizeEvent(bash('npm test', { tool_response: { stdout: 'x'.repeat(50000) + ' 3 failing', stderr: 'boom' } }), 'PostToolUse');
  assert.deepEqual(ev.tool_response, { error: true });
  assert.ok(JSON.stringify(ev).length < 600);
  const ok = sanitizeEvent(bash('npm test', { tool_response: { stdout: 'all good' } }), 'PostToolUse');
  assert.deepEqual(ok.tool_response, { ok: true });
  for (const r of [{ ok: true }, { error: true }, { interrupted: true }]) {
    const back = sanitizeEvent({ ...ok, tool_response: r }, null, { replay: true });
    assert.deepEqual(back.tool_response, r);
  }
});
