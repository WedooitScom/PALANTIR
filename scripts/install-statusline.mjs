#!/usr/bin/env node
// Plugs the map into the Claude Code status line (usage: 5 h / 7 day limits, context, cost).
// Adds ONE line, marked "# lotr-map-statusline", right after `input=$(cat)` in the status line script
// named by ~/.claude/settings.json -> statusLine.command. Idempotent, backup in <script>.bak-lotr.
//   node scripts/install-statusline.mjs            install
//   node scripts/install-statusline.mjs --create   no status line configured: install a minimal one
//   node scripts/install-statusline.mjs --dry-run  print the resulting script without writing
// Env: CLAUDE_SETTINGS (settings.json), CLAUDE_STATUSLINE_SCRIPT (script, bypasses settings.json),
//      LOTR_HOOK_DIR (stable copy of send-statusline.sh, e.g. ~/Library/Application Support/TerreDuMilieu).
import fs from 'node:fs';
import path from 'node:path';
import { BACKUP, SETTINGS, STATUSLINE_SCRIPT, STATUSLINE_SOURCE, readSettings, shQuote, writeSettings } from './hooks-common.mjs';
import { CREATED_PATH, insertLine, lineFor, locateScript, minimalScript, writeScript } from './statusline-common.mjs';

const dryRun = process.argv.includes('--dry-run');
const create = process.argv.includes('--create');

function copySender() {
  if (!fs.existsSync(STATUSLINE_SOURCE)) throw new Error(`Script introuvable : ${STATUSLINE_SOURCE}`);
  if (dryRun) return;
  if (STATUSLINE_SCRIPT !== STATUSLINE_SOURCE) {
    fs.mkdirSync(path.dirname(STATUSLINE_SCRIPT), { recursive: true });
    fs.copyFileSync(STATUSLINE_SOURCE, STATUSLINE_SCRIPT);
  }
  try {
    fs.chmodSync(STATUSLINE_SCRIPT, 0o755);
  } catch {
    /* ignore */
  }
}

function manual(reason) {
  console.log(`Rien n'a été modifié : ${reason}`);
  console.log('');
  console.log('Pour brancher la carte à la main, ajoute cette ligne dans ton script de status line,');
  console.log('juste après la lecture de l\'entrée (la variable doit s\'appeler input, ex. input=$(cat)) :');
  console.log('');
  console.log('  ' + lineFor());
  console.log('');
  process.exitCode = 2;
}

function main() {
  copySender();
  const { exists, data } = readSettings();
  const loc = locateScript(data);

  if (loc.none) {
    if (!create) {
      console.log(`Aucune status line n'est configurée dans ${SETTINGS}.`);
      console.log('Relance avec --create pour installer une status line minimale (modèle + contexte)');
      console.log(`qui transmet aussi l'usage à la carte : ${CREATED_PATH}`);
      process.exitCode = 2;
      return;
    }
    if (fs.existsSync(CREATED_PATH) && !fs.readFileSync(CREATED_PATH, 'utf8').includes('lotr-map-statusline-created')) {
      throw new Error(`${CREATED_PATH} existe déjà et n'a pas été créé par la carte. Rien n'a été modifié.`);
    }
    data.statusLine = { type: 'command', command: `sh ${shQuote(CREATED_PATH)}` };
    if (dryRun) {
      console.log(minimalScript());
      console.log(JSON.stringify({ statusLine: data.statusLine }, null, 2));
      return;
    }
    fs.writeFileSync(CREATED_PATH, minimalScript(), { mode: 0o755 });
    writeSettings(data, exists);
    console.log(`Status line minimale créée : ${CREATED_PATH}`);
    console.log(`settings.json mis à jour : ${SETTINGS}${exists ? ` (sauvegarde : ${BACKUP})` : ''}`);
    console.log(`Envoi : ${STATUSLINE_SCRIPT}`);
    return;
  }
  if (loc.error) return manual(loc.error);

  const file = loc.script;
  const before = fs.readFileSync(file, 'utf8');
  const r = insertLine(before);
  if (r.error) return manual(`${file} ne contient pas de ligne input=$(cat).`);
  if (r.text === before) {
    console.log(`Déjà installé dans ${file} : rien à faire.`);
    return;
  }
  if (dryRun) {
    console.log(r.text);
    return;
  }
  writeScript(file, r.text);
  console.log(`Status line branchée sur la carte : ${file}`);
  console.log(`Sauvegarde : ${file}.bak-lotr`);
  console.log(`Envoi : ${STATUSLINE_SCRIPT}`);
  console.log('Claude Code relit le script à chaque rafraîchissement : rien à relancer.');
}

try {
  main();
} catch (e) {
  console.error('Erreur :', e.message);
  process.exit(1);
}
