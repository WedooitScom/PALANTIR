'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');

// A status line script shaped like a typical user one (no jq needed).
const USER_SCRIPT = `#!/bin/sh
# my status line
input=$(cat)

model=$(printf '%s' "$input" | sed -n 's/.*"display_name":"\\([^"]*\\)".*/\\1/p')
ctx=$(printf '%s' "$input" | sed -n 's/.*"used_percentage":\\([0-9]*\\).*/\\1/p')
echo "\${model:-?} Ctx: \${ctx:-0}%"
`;
const SAMPLE = JSON.stringify({ session_id: 's', model: { id: 'claude-opus-5-5', display_name: 'Opus' }, context_window: { used_percentage: 42 } });

function setup(script = USER_SCRIPT, statusLine) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lotr-sl-'));
  const file = path.join(tmp, 'statusline-command.sh');
  fs.writeFileSync(file, script, { mode: 0o755 });
  const settings = path.join(tmp, 'settings.json');
  fs.writeFileSync(settings, JSON.stringify({ theme: 'dark', statusLine: statusLine === undefined ? { type: 'command', command: `sh ${file}` } : statusLine }));
  return { tmp, file, settings, hookDir: path.join(tmp, 'App Support') };
}

function run(script, ctx, args = []) {
  return spawnSync(process.execPath, [path.join(ROOT, 'scripts', script), ...args], {
    env: { ...process.env, CLAUDE_SETTINGS: ctx.settings, LOTR_HOOK_DIR: ctx.hookDir, CLAUDE_STATUSLINE_SCRIPT: '' },
    encoding: 'utf8',
  });
}

function statusOutput(file) {
  // Unused port: the forwarder must stay silent and fast even when the map is not running.
  const t0 = Date.now();
  const r = spawnSync('sh', [file], { input: SAMPLE, encoding: 'utf8', env: { ...process.env, LOTR_MAP_PORT: '9' } });
  return { out: r.stdout, err: r.stderr, status: r.status, ms: Date.now() - t0 };
}

test('install-statusline adds one marked line after input=$(cat), idempotent, output unchanged', () => {
  const ctx = setup();
  const before = statusOutput(ctx.file);
  assert.equal(before.out, 'Opus Ctx: 42%\n');

  const r = run('install-statusline.mjs', ctx);
  assert.equal(r.status, 0, r.stderr + r.stdout);
  const text = fs.readFileSync(ctx.file, 'utf8');
  const lines = text.split('\n');
  const i = lines.indexOf('input=$(cat)');
  assert.ok(lines[i + 1].endsWith('# lotr-map-statusline'), lines[i + 1]);
  assert.ok(lines[i + 1].includes(path.join(ctx.hookDir, 'send-statusline.sh')));
  assert.ok(fs.statSync(path.join(ctx.hookDir, 'send-statusline.sh')).mode & 0o100);
  assert.equal(fs.readFileSync(ctx.file + '.bak-lotr', 'utf8'), USER_SCRIPT);
  assert.ok(fs.statSync(ctx.file).mode & 0o100, 'mode kept');

  const after = statusOutput(ctx.file);
  assert.equal(after.out, before.out);
  assert.equal(after.err, '');
  assert.equal(after.status, 0);
  assert.ok(after.ms < 1500, `status line took ${after.ms} ms`);

  // Second run: nothing changes.
  const r2 = run('install-statusline.mjs', ctx);
  assert.equal(r2.status, 0);
  assert.match(r2.stdout, /Déjà installé/);
  assert.equal(fs.readFileSync(ctx.file, 'utf8'), text);
  assert.equal(text.split('# lotr-map-statusline').length, 2);

  // Uninstall restores the original script.
  const u = run('uninstall-statusline.mjs', ctx);
  assert.equal(u.status, 0, u.stderr);
  assert.equal(fs.readFileSync(ctx.file, 'utf8'), USER_SCRIPT);
  fs.rmSync(ctx.tmp, { recursive: true, force: true });
});

test('install-statusline handles quoted paths and executable scripts called directly', () => {
  const ctx = setup();
  fs.writeFileSync(ctx.settings, JSON.stringify({ statusLine: { type: 'command', command: `'${ctx.file}'` } }));
  const r = run('install-statusline.mjs', ctx);
  assert.equal(r.status, 0, r.stderr + r.stdout);
  assert.ok(fs.readFileSync(ctx.file, 'utf8').includes('# lotr-map-statusline'));
  fs.rmSync(ctx.tmp, { recursive: true, force: true });
});

test('install-statusline touches nothing when it cannot edit safely', () => {
  // No input=$(cat).
  const a = setup('#!/bin/sh\nread -r line\necho hi\n');
  const ra = run('install-statusline.mjs', a);
  assert.equal(ra.status, 2);
  assert.match(ra.stdout, /Rien n'a été modifié/);
  assert.match(ra.stdout, /lotr-map-statusline/);
  assert.equal(fs.readFileSync(a.file, 'utf8'), '#!/bin/sh\nread -r line\necho hi\n');
  assert.equal(fs.existsSync(a.file + '.bak-lotr'), false);
  // Not a plain script call.
  const b = setup(USER_SCRIPT, { type: 'command', command: 'npx ccstatusline | head -1' });
  const rb = run('install-statusline.mjs', b);
  assert.equal(rb.status, 2);
  assert.equal(fs.readFileSync(b.file, 'utf8'), USER_SCRIPT);
  // Not a shell script.
  const c = setup('#!/usr/bin/env python3\ninput=$(cat)\n', undefined);
  fs.writeFileSync(c.settings, JSON.stringify({ statusLine: { type: 'command', command: c.file } }));
  const rc = run('install-statusline.mjs', c);
  assert.equal(rc.status, 2);
  for (const x of [a, b, c]) fs.rmSync(x.tmp, { recursive: true, force: true });
});

test('no status line: explains, and --create installs a minimal one', () => {
  const ctx = setup(USER_SCRIPT, null);
  fs.writeFileSync(ctx.settings, JSON.stringify({ theme: 'dark' }));
  const r = run('install-statusline.mjs', ctx);
  assert.equal(r.status, 2);
  assert.match(r.stdout, /--create/);
  assert.deepEqual(JSON.parse(fs.readFileSync(ctx.settings, 'utf8')), { theme: 'dark' });

  const c = run('install-statusline.mjs', ctx, ['--create']);
  assert.equal(c.status, 0, c.stderr + c.stdout);
  const settings = JSON.parse(fs.readFileSync(ctx.settings, 'utf8'));
  assert.equal(settings.theme, 'dark');
  assert.match(settings.statusLine.command, /^sh '.*lotr-statusline\.sh'$/);
  const created = path.join(ctx.tmp, 'lotr-statusline.sh');
  const out = statusOutput(created);
  assert.equal(out.status, 0);
  assert.equal(out.err, '');
  // Re-running install on the created script is a no-op.
  const again = run('install-statusline.mjs', ctx);
  assert.match(again.stdout, /Déjà installé/);
  // Uninstall removes the statusLine setting.
  const u = run('uninstall-statusline.mjs', ctx);
  assert.equal(u.status, 0, u.stderr);
  assert.deepEqual(JSON.parse(fs.readFileSync(ctx.settings, 'utf8')), { theme: 'dark' });
  fs.rmSync(ctx.tmp, { recursive: true, force: true });
});
