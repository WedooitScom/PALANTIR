#!/usr/bin/env node
// Removes the map hooks from ~/.claude/settings.json (backup in settings.json.bak-lotr).
// Other hooks and settings are left untouched.
//   node scripts/uninstall-hooks.mjs            uninstall
//   node scripts/uninstall-hooks.mjs --dry-run  print the resulting settings without writing
import { BACKUP, SETTINGS, readSettings, stripOurs, writeSettings } from './hooks-common.mjs';

const dryRun = process.argv.includes('--dry-run');

function main() {
  const { exists, data } = readSettings();
  if (!exists) {
    console.log(`${SETTINGS} n'existe pas : rien à désinstaller.`);
    return;
  }
  const hooks = data.hooks;
  if (!hooks || typeof hooks !== 'object' || Array.isArray(hooks)) {
    console.log('Aucun hook trouvé : rien à désinstaller.');
    return;
  }
  let total = 0;
  for (const ev of Object.keys(hooks)) {
    if (!Array.isArray(hooks[ev])) continue;
    const { groups, removed } = stripOurs(hooks[ev]);
    if (!removed) continue;
    total += removed;
    if (groups.length) hooks[ev] = groups;
    else delete hooks[ev];
  }
  if (!total) {
    console.log('Aucun hook de la Carte trouvé : rien à faire.');
    return;
  }
  if (Object.keys(hooks).length === 0) delete data.hooks;

  if (dryRun) {
    console.log(JSON.stringify(data, null, 2));
    return;
  }
  writeSettings(data, true);
  console.log(`${total} hook(s) de la Carte retiré(s) de ${SETTINGS}`);
  console.log(`Sauvegarde : ${BACKUP}`);
}

try {
  main();
} catch (e) {
  console.error('Erreur :', e.message);
  process.exit(1);
}
