'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { Store, sanitizeEvent, roleFor } = require('../lib/store');

function mkStore() {
  return new Store({ file: null });
}

test('PreToolUse Edit creates a coding session named after cwd', () => {
  const s = mkStore();
  s.ingest({ session_id: 's1', cwd: '/x/y/LOTRAgent', hook_event_name: 'PreToolUse', tool_name: 'Edit', tool_input: { file_path: '/x/y/LOTRAgent/server.js', old_string: 'a'.repeat(10000), new_string: 'b' } });
  const a = s.agents.get('s1');
  assert.equal(a.project, 'LOTRAgent');
  assert.equal(a.status, 'coding');
  assert.equal(a.lastAction, 'Édite server.js');
  assert.equal(a.counters.Edit, 1);
  assert.ok(a.territory);
  assert.match(s.chronicle.at(-1).text, /nain de LOTRAgent .* server\.js/);
});

test('large inputs are truncated / dropped', () => {
  const ev = sanitizeEvent({ session_id: 's', tool_name: 'Write', tool_input: { file_path: '/a', content: 'x'.repeat(50000) }, tool_response: 'y'.repeat(50000) }, 'PostToolUse');
  assert.equal(ev.tool_input.content, undefined);
  assert.equal(ev.tool_input.content_length, 50000);
  assert.equal(ev.tool_response, undefined);
  assert.ok(JSON.stringify(ev).length < 1000);
});

test('Agent spawn creates a subagent, subagent tools are attributed, SubagentStop finishes it', () => {
  const s = mkStore();
  s.ingest({ session_id: 's1', cwd: '/p/AFT', hook_event_name: 'PreToolUse', tool_name: 'Agent', tool_use_id: 'tu1', tool_input: { subagent_type: 'researcher', description: 'Explorer', prompt: 'Cherche' } });
  const child = s.agents.get('s1::tu1');
  assert.ok(child);
  assert.equal(child.role, 'scout');
  assert.equal(s.agents.get('s1').status, 'talking');
  assert.equal(s.council.at(-1).kind, 'spawn');

  s.ingest({ session_id: 's1', hook_event_name: 'PreToolUse', tool_name: 'WebSearch', agent_id: 'ag1', agent_type: 'researcher', tool_input: { query: 'node sse' } });
  assert.equal(child.agentId, 'ag1');
  assert.equal(child.counters.WebSearch, 1);
  assert.equal(s.agents.get('s1').counters.WebSearch, undefined);

  s.ingest({ session_id: 's1', hook_event_name: 'SubagentStop', agent_id: 'ag1' });
  assert.equal(child.status, 'done');
  s.ingest({ session_id: 's1', hook_event_name: 'PostToolUse', tool_name: 'Agent', tool_use_id: 'tu1', tool_input: { subagent_type: 'researcher' }, tool_response: { content: [{ type: 'text', text: 'Trouvé 3 fichiers' }] } });
  assert.equal(child.result, 'Trouvé 3 fichiers');
  assert.equal(s.council.at(-1).kind, 'return');
});

test('Notification raises an alert that clears on the next tool use', () => {
  const s = mkStore();
  s.ingest({ session_id: 's1', cwd: '/p/AFT-CUP', hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'npm test' } });
  s.ingest({ session_id: 's1', hook_event_name: 'Notification', message: 'Claude needs your permission to use Bash' });
  const a = s.agents.get('s1');
  assert.equal(a.status, 'waiting');
  assert.match(a.waiting.message, /permission d'utiliser Bash/);
  s.ingest({ session_id: 's1', hook_event_name: 'PostToolUse', tool_name: 'Bash' });
  assert.equal(a.status, 'running');
  assert.equal(a.waiting, null);
});

test('invalid payloads never throw', () => {
  const s = mkStore();
  for (const raw of [null, 42, 'str', [], { session_id: { weird: true } }, { tool_input: [1, 2] }]) {
    assert.doesNotThrow(() => s.ingest(raw, { hook: 'PreToolUse' }));
  }
});

test('inactive sessions become done then disappear', () => {
  const s = mkStore();
  s.ingest({ session_id: 's1', cwd: '/p/A', hook_event_name: 'Stop' });
  const t0 = s.agents.get('s1').lastSeen;
  s.sweep(t0 + 31 * 60 * 1000);
  assert.equal(s.agents.get('s1').status, 'done');
  s.sweep(t0 + 2 * 60 * 60 * 1000 + 1000);
  assert.equal(s.agents.has('s1'), false);
});

test('territories are distinct for concurrent sessions', () => {
  const s = mkStore();
  for (let i = 0; i < 10; i++) s.ingest({ session_id: 'sess' + i, cwd: '/p/P' + i, hook_event_name: 'SessionStart' });
  const terr = new Set([...s.agents.values()].map((a) => a.territory));
  assert.equal(terr.size, 10);
});

test('roleFor maps subagent types', () => {
  assert.equal(roleFor('implementer'), 'dwarf');
  assert.equal(roleFor('researcher'), 'scout');
  assert.equal(roleFor('architect-reviewer'), 'wizard');
  assert.equal(roleFor('designer'), 'painter');
  assert.equal(roleFor('build-runner'), 'troll');
});
