#!/usr/bin/env node
// Removes the map line ("# lotr-map-statusline") from the status line script (backup in .bak-lotr).
// If the status line is the minimal one created by --create, the statusLine setting is removed too
// (the file is left in place).
//   node scripts/uninstall-statusline.mjs [--dry-run]
import fs from 'node:fs';
import { BACKUP, SETTINGS, readSettings, writeSettings } from './hooks-common.mjs';
import { CREATED_MARKER, locateScript, stripLine, writeScript } from './statusline-common.mjs';

const dryRun = process.argv.includes('--dry-run');

function main() {
  const { exists, data } = readSettings();
  const loc = locateScript(data);
  if (loc.none) {
    console.log('Aucune status line configurée : rien à désinstaller.');
    return;
  }
  if (loc.error) {
    console.log(`Rien n'a été modifié : ${loc.error}`);
    return;
  }
  const file = loc.script;
  const before = fs.readFileSync(file, 'utf8');
  if (before.includes(CREATED_MARKER)) {
    if (dryRun) {
      console.log('statusLine serait retiré de settings.json');
      return;
    }
    delete data.statusLine;
    writeSettings(data, exists);
    console.log(`Status line minimale de la carte retirée de ${SETTINGS} (sauvegarde : ${BACKUP}).`);
    console.log(`Le fichier ${file} est conservé : supprime-le si tu n'en veux plus.`);
    return;
  }
  const after = stripLine(before);
  if (after === before) {
    console.log(`Aucune ligne de la carte dans ${file} : rien à faire.`);
    return;
  }
  if (dryRun) {
    console.log(after);
    return;
  }
  writeScript(file, after);
  console.log(`Ligne de la carte retirée de ${file} (sauvegarde : ${file}.bak-lotr).`);
}

try {
  main();
} catch (e) {
  console.error('Erreur :', e.message);
  process.exit(1);
}
