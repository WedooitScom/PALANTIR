'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Store } = require('../lib/store');
const { normalizeStatusline, stepWatch, newWatch, FIVE_LEVELS } = require('../lib/usage');
const { TranscriptReader, usageFromLine } = require('../lib/transcripts');

const FIXTURES = path.join(__dirname, 'fixtures', 'projects');
const SESSION_FILE = path.join(FIXTURES, '-tmp-proj', 'sess-1.jsonl');

function statusline(o = {}) {
  return {
    session_id: 's1',
    transcript_path: '/nowhere/s1.jsonl',
    cwd: '/p/LOTRAgent',
    model: { id: 'claude-opus-5-5', display_name: 'Opus' },
    workspace: { current_dir: '/p/LOTRAgent' },
    cost: { total_cost_usd: 1.5, total_duration_ms: 60000, total_lines_added: 12, total_lines_removed: 4 },
    context_window: { used_percentage: 40, context_window_size: 200000 },
    rate_limits: { five_hour: { used_percentage: 21, resets_at: 2000000000 }, seven_day: { used_percentage: 20, resets_at: 2000500000 } },
    ...o,
  };
}

function usageLogs(store) {
  return store.chronicle.filter((e) => e.kind === 'usage').map((e) => e.text);
}

// ------------------------------------------------------------ status line normalization

test('normalizeStatusline keeps only known numbers and short strings', () => {
  const n = normalizeStatusline({ ...statusline(), extra: 'x'.repeat(10000), transcript: { content: 'secret' } }, 1234);
  assert.equal(n.at, 1234);
  assert.equal(n.session_id, 's1');
  assert.deepEqual(n.model, { id: 'claude-opus-5-5', name: 'Opus' });
  assert.equal(n.context.pct, 40);
  assert.equal(n.context.size, 200000);
  assert.deepEqual(n.cost, { usd: 1.5, durationMs: 60000, linesAdded: 12, linesRemoved: 4 });
  assert.deepEqual(n.five, { pct: 21, resetsAt: 2000000000 });
  assert.deepEqual(n.seven, { pct: 20, resetsAt: 2000500000 });
  assert.ok(!JSON.stringify(n).includes('secret'));
  assert.ok(JSON.stringify(n).length < 600);
});

test('normalizeStatusline: every field optional, odd types tolerated', () => {
  for (const raw of [null, 42, 'str', [], {}, { model: 'x', cost: [], rate_limits: 'no' }]) {
    const n = normalizeStatusline(raw);
    assert.equal(n.five, undefined);
    assert.equal(n.model, undefined);
    assert.equal(n.session_id, undefined);
  }
  // cwd fallback, numeric strings, ms timestamps, ISO dates, clamping.
  const n = normalizeStatusline({
    workspace: { current_dir: '/a/b' },
    context_window: { used_percentage: '130' },
    rate_limits: { five_hour: { used_percentage: '55.5', resets_at: 2000000000123 }, seven_day: { resets_at: '2033-05-18T03:33:20Z' } },
  });
  assert.equal(n.cwd, '/a/b');
  assert.equal(n.context.pct, 100);
  assert.deepEqual(n.five, { pct: 55.5, resetsAt: 2000000000 });
  assert.equal(n.seven.pct, null);
  assert.equal(n.seven.resetsAt, 2000000000);
  // Context % computed from current_usage when used_percentage is missing.
  const c = normalizeStatusline({ context_window: { context_window_size: 200000, current_usage: { input_tokens: 1000, cache_read_input_tokens: 49000 } } });
  assert.equal(c.context.pct, 25);
});

test('status line of an unknown session is kept aside (no ghost agent), then applied', () => {
  const s = new Store({ file: null });
  s.ingestStatusline(statusline());
  assert.equal(s.agents.size, 0);
  assert.equal(s.usage.real.five.pct, 21);
  assert.equal(s.usage.real.seven.pct, 20);
  s.ingest({ session_id: 's1', cwd: '/p/LOTRAgent', hook_event_name: 'SessionStart' });
  const a = s.agents.get('s1');
  assert.equal(a.usage.contextPct, 40);
  assert.equal(a.usage.costUsd, 1.5);
  assert.equal(a.usage.model.name, 'Opus');
  assert.equal(a.usage.linesAdded, 12);
  // Later ticks update in place and never write the chronicle.
  const before = s.chronicle.length;
  for (let i = 0; i < 20; i++) s.ingestStatusline(statusline({ context_window: { used_percentage: 41 + i } }));
  assert.equal(a.usage.contextPct, 60);
  assert.equal(s.chronicle.length, before);
  const snap = s.snapshot();
  assert.equal(snap.usage.real.five.pct, 21);
  assert.equal(snap.usage.real.today.costUsd, 1.5);
  assert.equal(snap.usage.demo, null);
});

test('demo usage never overwrites real usage', () => {
  const s = new Store({ file: null });
  s.ingestStatusline(statusline());
  s.ingestStatusline(statusline({ session_id: 'demo-x', rate_limits: { five_hour: { used_percentage: 99, resets_at: 2000000000 } } }), { demo: true });
  const u = s.snapshot().usage;
  assert.equal(u.real.five.pct, 21);
  assert.equal(u.demo.five.pct, 99);
  assert.equal(u.demo.demo, true);
  s.removeDemo();
  assert.equal(s.snapshot().usage.demo, null);
  assert.equal(s.snapshot().usage.real.five.pct, 21);
});

test('limits: same window keeps the max, stale windows are ignored, newer windows win', () => {
  const s = new Store({ file: null });
  const lim = (pct, resets_at) => ({ session_id: undefined, rate_limits: { five_hour: { used_percentage: pct, resets_at } } });
  s.ingestStatusline(lim(40, 2000000000));
  s.ingestStatusline(lim(35, 2000000030)); // older value re-rendered by an idle session
  assert.equal(s.usage.real.five.pct, 40);
  s.ingestStatusline(lim(90, 1990000000)); // previous window
  assert.equal(s.usage.real.five.pct, 40);
  s.ingestStatusline(lim(5, 2000018000)); // next window
  assert.equal(s.usage.real.five.pct, 5);
  assert.equal(s.usage.real.five.resetsAt, 2000018000);
});

// ------------------------------------------------------------ chronicle thresholds

test('5 h thresholds: one message per level and window, highest level only on a jump', () => {
  const s = new Store({ file: null });
  const tick = (pct, resets_at = 2000000000) => s.ingestStatusline({ rate_limits: { five_hour: { used_percentage: pct, resets_at } } });
  for (const p of [10, 40, 52, 55, 52, 79, 82, 82.5, 85, 91, 95, 100, 100, 100]) tick(p);
  assert.deepEqual(usageLogs(s), [
    'La moitié des lembas est entamée : 52 % de la limite 5 h',
    "Les lembas s'épuisent : 82 % de la limite 5 h",
    "Les lembas s'épuisent : 91 % de la limite 5 h",
    'Une ombre ailée passe sur la Terre du Milieu : 95 % de la limite 5 h',
    "Plus de lembas ! Limite 5 h atteinte (100 %) : la compagnie campe jusqu'au reset",
  ]);
  assert.equal(s.chronicle.at(-1).icon, '🏕');
  assert.deepEqual(s.chronicle.filter((e) => e.kind === 'usage').map((e) => [e.key, e.params.pct]), [
    ['log.five50', 52], ['log.five80', 82], ['log.five80', 91], ['log.five95', 95], ['log.five100', 100],
  ]);
  // New window: reset announced once, levels re-armed; a jump announces only the highest level.
  tick(3, 2000018000);
  tick(4, 2000018000);
  tick(93, 2000018000);
  tick(94, 2000018000);
  assert.deepEqual(usageLogs(s).slice(5), [
    'Les réserves sont reconstituées (limite 5 h)',
    "Les lembas s'épuisent : 93 % de la limite 5 h",
  ]);
});

test('7 day thresholds: 80 % and 90 % only', () => {
  const s = new Store({ file: null });
  for (const p of [50, 70, 79, 80, 85, 89, 90, 99]) s.ingestStatusline({ rate_limits: { seven_day: { used_percentage: p, resets_at: 2000500000 } } });
  assert.deepEqual(usageLogs(s), [
    'Les greniers se vident : 80 % de la limite 7 jours',
    'Les greniers se vident : 90 % de la limite 7 jours',
  ]);
  assert.deepEqual(s.chronicle.map((e) => e.key), ['log.seven', 'log.seven']);
});

test('stepWatch without resets_at treats a big drop as a reset', () => {
  const st = newWatch();
  assert.equal(stepWatch(st, { pct: 60, resetsAt: null }, FIVE_LEVELS).level, 50);
  assert.equal(stepWatch(st, { pct: 61, resetsAt: null }, FIVE_LEVELS).level, null);
  const r = stepWatch(st, { pct: 10, resetsAt: null }, FIVE_LEVELS);
  assert.equal(r.reset, true);
  assert.equal(stepWatch(st, { pct: 51, resetsAt: null }, FIVE_LEVELS).level, 50);
});

test('context above 85 % is announced once, re-armed after dropping below 70 %', () => {
  const s = new Store({ file: null });
  s.ingest({ session_id: 's1', cwd: '/p/LOTRAgent', hook_event_name: 'SessionStart' });
  const ctx = (p) => s.ingestStatusline({ session_id: 's1', context_window: { used_percentage: p } });
  for (const p of [50, 84, 86, 90, 95, 88, 75]) ctx(p);
  assert.equal(usageLogs(s).length, 1);
  assert.match(usageLogs(s)[0], /sac de LOTRAgent est plein : 86 %/);
  assert.deepEqual(s.chronicle.at(-1).params, { who: 'LOTRAgent', pct: 86 });
  ctx(30); // compacted
  ctx(87);
  assert.equal(usageLogs(s).length, 2);
});

test('announced thresholds survive a restart (usage-state.json)', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lotr-usage-'));
  const file = path.join(dir, 'events.jsonl');
  const s1 = new Store({ file });
  s1.ingestStatusline({ rate_limits: { five_hour: { used_percentage: 82, resets_at: 2000000000 } } });
  assert.equal(usageLogs(s1).length, 1);
  await new Promise((r) => setTimeout(r, 2200)); // debounced save
  const s2 = new Store({ file });
  s2.loadUsageState();
  assert.equal(s2.usage.real.five.pct, 82);
  s2.ingestStatusline({ rate_limits: { five_hour: { used_percentage: 84, resets_at: 2000000000 } } });
  assert.equal(usageLogs(s2).length, 0);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('95 % threshold: announced once with a nazgul fx, not repeated after a restart', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lotr-usage-'));
  const file = path.join(dir, 'events.jsonl');
  const s1 = new Store({ file });
  const fx = [];
  s1.on('broadcast', (type, data) => { if (type === 'fx') fx.push(data); });
  for (const p of [91, 95, 96, 97]) s1.ingestStatusline({ rate_limits: { five_hour: { used_percentage: p, resets_at: 2000000000 } } });
  assert.deepEqual(s1.chronicle.filter((e) => e.kind === 'usage').map((e) => e.key), ['log.five80', 'log.five95']);
  assert.equal(s1.chronicle.at(-1).level, 95);
  assert.deepEqual(fx.map((f) => f.type), ['nazgul']);
  await new Promise((r) => setTimeout(r, 2200)); // debounced save
  const s2 = new Store({ file });
  s2.loadUsageState();
  assert.ok(s2.usage.real.watch.five.done.includes(95));
  const fx2 = [];
  s2.on('broadcast', (type, data) => { if (type === 'fx') fx2.push(data); });
  s2.ingestStatusline({ rate_limits: { five_hour: { used_percentage: 98, resets_at: 2000000000 } } });
  assert.equal(usageLogs(s2).length, 0);
  assert.equal(fx2.length, 0);
  fs.rmSync(dir, { recursive: true, force: true });
});

// ------------------------------------------------------------ transcripts

test('usageFromLine ignores non-assistant lines and broken JSON', () => {
  assert.equal(usageFromLine('not json "usage"'), null);
  assert.equal(usageFromLine('{"type":"user","message":{"usage":{}}}'), null);
  assert.equal(usageFromLine('{"type":"assistant","isSidechain":true,"message":{"id":"m","usage":{"input_tokens":1}}}', { skipSidechain: true }), null);
  const u = usageFromLine('{"type":"assistant","requestId":"r","message":{"model":"<synthetic>","usage":{"output_tokens":5}}}');
  assert.equal(u.id, 'r');
  assert.equal(u.model, null);
  assert.equal(u.output, 5);
});

function withReader(root) {
  const store = new Store({ file: null });
  const reader = new TranscriptReader({ root, onUsage: (id, d, m, days) => store.addTokens(id, d, m, days) });
  store.attachTranscripts(reader);
  return { store, reader };
}

test('transcript usage is deduplicated by message.id / requestId, sidechain and content ignored', async () => {
  const { store, reader } = withReader(FIXTURES);
  store.ingest({ session_id: 'sess-1', cwd: '/tmp/proj', transcript_path: SESSION_FILE, hook_event_name: 'SessionStart' });
  await reader.flush();
  const t = store.agents.get('sess-1').tokens;
  assert.deepEqual({ ...t }, { input: 12, output: 150, cacheCreation: 1000, cacheRead: 11000, total: 12162, model: 'claude-opus-5-5' });
  // Reading again (no new bytes) adds nothing.
  await reader.flush();
  assert.equal(store.agents.get('sess-1').tokens.total, 12162);
  const snap = JSON.stringify(store.snapshot());
  assert.ok(!snap.includes('secret'), 'no message content may be stored');
  // Fixture entries are dated 2025-01-15: bucketed on their own day, not today.
  assert.equal(store.snapshot().usage.real, null); // nothing today, no status line
  assert.equal(store.usage.real.daily.get('2025-01-15'), undefined); // pruned (only today and yesterday are kept)
});

test('transcripts are read incrementally from the last offset', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lotr-tr-'));
  const dir = path.join(root, '-p');
  fs.mkdirSync(dir);
  const file = path.join(dir, 's.jsonl');
  fs.copyFileSync(SESSION_FILE, file);
  const { store, reader } = withReader(root);
  store.ingest({ session_id: 's', cwd: '/p', transcript_path: file, hook_event_name: 'SessionStart' });
  await reader.flush();
  assert.equal(store.agents.get('s').tokens.total, 12162);
  const now = new Date().toISOString();
  const line = (id, out) => JSON.stringify({ type: 'assistant', timestamp: now, message: { id, model: 'claude-sonnet-4-5', usage: { input_tokens: 1, output_tokens: out } } }) + '\n';
  // A duplicate of an old message + a new one, the new one split over two writes.
  const fresh = line('msg_new', 9);
  fs.appendFileSync(file, line('msg_1', 100) + fresh.slice(0, 20));
  await reader.flush();
  assert.equal(store.agents.get('s').tokens.total, 12162);
  fs.appendFileSync(file, fresh.slice(20));
  await reader.flush();
  const t = store.agents.get('s').tokens;
  assert.equal(t.total, 12172);
  assert.equal(t.model, 'claude-sonnet-4-5');
  assert.equal(store.snapshot().usage.real.today.tokens.total, 10);
  fs.rmSync(root, { recursive: true, force: true });
});

test('subagent tokens come from its own transcript and add up on the session', async () => {
  const { store, reader } = withReader(FIXTURES);
  store.ingest({ session_id: 'sess-1', cwd: '/tmp/proj', transcript_path: SESSION_FILE, hook_event_name: 'PreToolUse', tool_name: 'Agent', tool_use_id: 'tu1', tool_input: { subagent_type: 'researcher', description: 'x' } });
  store.ingest({ session_id: 'sess-1', transcript_path: SESSION_FILE, hook_event_name: 'PreToolUse', tool_name: 'Read', agent_id: 'ab12', agent_type: 'researcher', tool_input: { file_path: '/a' } });
  await reader.flush();
  const child = store.agents.get('sess-1::tu1');
  assert.equal(child.transcriptPath, path.join(FIXTURES, '-tmp-proj', 'sess-1', 'subagents', 'agent-ab12.jsonl'));
  assert.equal(child.tokens.total, 3333);
  assert.equal(child.tokens.model, 'claude-sonnet-4-5');
  const s = store.agents.get('sess-1');
  assert.equal(s.subTokens.total, 3333);
  assert.equal(s.tokens.total, 12162); // the session file's sidechain line is not counted
  assert.equal(s.subagentTotal, 1);
});

test('files outside the transcripts root are never read', async () => {
  const { store, reader } = withReader(path.join(FIXTURES, '-nope'));
  store.ingest({ session_id: 'sess-1', cwd: '/tmp/proj', transcript_path: SESSION_FILE, hook_event_name: 'Stop' });
  store.ingest({ session_id: 'x', cwd: '/tmp/proj', transcript_path: '/etc/passwd', hook_event_name: 'Stop' });
  await reader.flush();
  assert.equal(reader.tracks.size, 0);
  assert.equal(store.agents.get('sess-1').tokens, null);
  assert.equal(reader.allowed(path.join(FIXTURES, '-nope', '..', '-tmp-proj', 'sess-1.jsonl')), null);
});
