#!/usr/bin/env node
// Adds the map hooks to ~/.claude/settings.json (idempotent, backup in settings.json.bak-lotr).
// Only the "hooks" key is touched; existing hooks are preserved.
//   node scripts/install-hooks.mjs            install
//   node scripts/install-hooks.mjs --dry-run  print the resulting settings without writing
import fs from 'node:fs';
import {
  BACKUP, EVENTS, SCRIPT, SETTINGS, WITH_MATCHER, commandFor, readSettings, stripOurs, writeSettings,
} from './hooks-common.mjs';

const dryRun = process.argv.includes('--dry-run');

function main() {
  if (!fs.existsSync(SCRIPT)) throw new Error(`Script introuvable : ${SCRIPT}`);
  if (!dryRun) {
    try {
      fs.chmodSync(SCRIPT, 0o755);
    } catch {
      /* ignore */
    }
  }

  const { exists, data } = readSettings();
  const settings = data;
  if (settings.hooks !== undefined && (typeof settings.hooks !== 'object' || settings.hooks === null || Array.isArray(settings.hooks))) {
    throw new Error('La clé "hooks" de settings.json a un format inattendu. Rien n\'a été modifié.');
  }
  const hooks = settings.hooks || {};
  const skipped = [];

  for (const ev of EVENTS) {
    if (hooks[ev] !== undefined && !Array.isArray(hooks[ev])) {
      skipped.push(ev);
      continue;
    }
    const { groups } = stripOurs(hooks[ev] || []);
    const entry = { type: 'command', command: commandFor(ev), timeout: 5 };
    groups.push(WITH_MATCHER.has(ev) ? { matcher: '*', hooks: [entry] } : { hooks: [entry] });
    hooks[ev] = groups;
  }
  settings.hooks = hooks;

  if (dryRun) {
    console.log(JSON.stringify(settings, null, 2));
    return;
  }
  writeSettings(settings, exists);
  console.log(`Hooks de la Carte installés dans ${SETTINGS}`);
  if (exists) console.log(`Sauvegarde : ${BACKUP}`);
  if (skipped.length) console.log(`Ignorés (format inattendu) : ${skipped.join(', ')}`);
  console.log('Relance tes sessions Claude Code (ou /hooks) pour activer les hooks, puis : npm start');
}

try {
  main();
} catch (e) {
  console.error('Erreur :', e.message);
  process.exit(1);
}
