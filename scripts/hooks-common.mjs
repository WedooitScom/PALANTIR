// Shared helpers for install-hooks / uninstall-hooks.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(here, '..');
// The hook script shipped with this copy of the project.
export const SOURCE_SCRIPT = path.join(ROOT, 'hooks', 'send-event.sh');
// LOTR_HOOK_DIR: install a stable copy of the script there (used by the macOS app, so that moving
// or updating the .app never breaks the path written in settings.json). Default: use it in place.
export const HOOK_DIR = process.env.LOTR_HOOK_DIR || '';
export const SCRIPT = HOOK_DIR ? path.join(path.resolve(HOOK_DIR), 'send-event.sh') : SOURCE_SCRIPT;
export const MARKER = 'lotr-map-hook';
// CLAUDE_SETTINGS lets you target another file (handy for testing).
export const SETTINGS = process.env.CLAUDE_SETTINGS || path.join(os.homedir(), '.claude', 'settings.json');
export const BACKUP = SETTINGS + '.bak-lotr';

export const EVENTS = [
  'SessionStart',
  'UserPromptSubmit',
  'PreToolUse',
  'PostToolUse',
  'Notification',
  'Stop',
  'SubagentStop',
  'SessionEnd',
];
// Events whose hooks are filtered by a tool-name matcher.
export const WITH_MATCHER = new Set(['PreToolUse', 'PostToolUse']);

export function shQuote(s) {
  return `'${String(s).replace(/'/g, `'\\''`)}'`;
}

export function commandFor(event) {
  return `${shQuote(SCRIPT)} ${event} # ${MARKER}`;
}

export function isOurs(hook) {
  const cmd = hook && typeof hook === 'object' ? hook.command : null;
  return typeof cmd === 'string' && (cmd.includes(MARKER) || cmd.includes(SCRIPT));
}

/** Removes our hook entries from a list of matcher groups. Returns { groups, removed }. */
export function stripOurs(groups) {
  let removed = 0;
  const out = [];
  for (const g of groups) {
    if (!g || typeof g !== 'object' || !Array.isArray(g.hooks)) {
      out.push(g);
      continue;
    }
    const kept = g.hooks.filter((h) => {
      const ours = isOurs(h);
      if (ours) removed++;
      return !ours;
    });
    if (kept.length === g.hooks.length) out.push(g);
    else if (kept.length > 0) out.push({ ...g, hooks: kept });
    // else: the group only contained our hooks -> drop it
  }
  return { groups: out, removed };
}

export function readSettings() {
  if (!fs.existsSync(SETTINGS)) return { exists: false, data: {} };
  const text = fs.readFileSync(SETTINGS, 'utf8');
  if (!text.trim()) return { exists: true, data: {} };
  let data;
  try {
    data = JSON.parse(text);
  } catch (e) {
    throw new Error(`${SETTINGS} n'est pas un JSON valide (${e.message}). Rien n'a été modifié.`);
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error(`${SETTINGS} ne contient pas un objet JSON. Rien n'a été modifié.`);
  }
  return { exists: true, data };
}

export function writeSettings(data, existed) {
  fs.mkdirSync(path.dirname(SETTINGS), { recursive: true });
  if (existed) fs.copyFileSync(SETTINGS, BACKUP);
  const tmp = SETTINGS + '.tmp-lotr';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n');
  fs.renameSync(tmp, SETTINGS);
}
