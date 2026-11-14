'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');

function run(script, env) {
  return spawnSync(process.execPath, [path.join(ROOT, 'scripts', script)], {
    env: { ...process.env, ...env },
    encoding: 'utf8',
  });
}

test('install with LOTR_HOOK_DIR copies the hook script and points settings.json at the copy', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lotr-hooks-'));
  const settings = path.join(tmp, 'settings.json');
  const hookDir = path.join(tmp, 'Application Support', 'TerreDuMilieu');
  fs.writeFileSync(settings, JSON.stringify({ theme: 'dark', hooks: { Stop: [{ hooks: [{ type: 'command', command: 'echo other' }] }] } }));

  const r = run('install-hooks.mjs', { CLAUDE_SETTINGS: settings, LOTR_HOOK_DIR: hookDir });
  assert.equal(r.status, 0, r.stderr);
  const copy = path.join(hookDir, 'send-event.sh');
  assert.ok(fs.existsSync(copy));
  assert.ok(fs.statSync(copy).mode & 0o100, 'copy must be executable');

  const data = JSON.parse(fs.readFileSync(settings, 'utf8'));
  assert.equal(data.theme, 'dark');
  assert.equal(data.hooks.Stop.length, 2);
  const cmd = data.hooks.Stop[1].hooks[0].command;
  assert.ok(cmd.includes(copy), cmd);

  // Uninstall from the repo copy (no LOTR_HOOK_DIR) still finds them through the marker.
  const u = run('uninstall-hooks.mjs', { CLAUDE_SETTINGS: settings, LOTR_HOOK_DIR: '' });
  assert.equal(u.status, 0, u.stderr);
  const after = JSON.parse(fs.readFileSync(settings, 'utf8'));
  assert.deepEqual(after.hooks, { Stop: [{ hooks: [{ type: 'command', command: 'echo other' }] }] });
  fs.rmSync(tmp, { recursive: true, force: true });
});
