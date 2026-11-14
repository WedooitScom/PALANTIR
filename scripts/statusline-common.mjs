// Shared helpers for install-statusline / uninstall-statusline.
// The status line command is read from settings.json -> statusLine.command; only a plain shell script
// ("sh /path/script.sh", "bash '/path'", "/path/script.sh" with a sh/bash/zsh shebang) is edited.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SETTINGS, STATUSLINE_MARKER, STATUSLINE_SCRIPT, shQuote } from './hooks-common.mjs';

export const CREATED_MARKER = 'lotr-map-statusline-created';
export const CREATED_PATH = path.join(path.dirname(SETTINGS), 'lotr-statusline.sh');
// CLAUDE_STATUSLINE_SCRIPT targets a script directly (tests), bypassing settings.json.
export const SCRIPT_OVERRIDE = process.env.CLAUDE_STATUSLINE_SCRIPT || '';

const SHELLS = /^(?:\/usr\/bin\/env\s+)?(?:\/(?:usr\/)?(?:local\/)?bin\/)?(sh|bash|zsh|dash)$/;

function expandHome(p) {
  if (p === '~' || p.startsWith('~/')) return path.join(os.homedir(), p.slice(1));
  return p;
}

/** Splits a simple command line into words (single/double quotes, $HOME, no operators). */
function words(cmd) {
  cmd = cmd.replace(/\$\{HOME\}|\$HOME(?![A-Za-z0-9_])/g, os.homedir());
  const out = [];
  let cur = '';
  let q = null;
  let has = false;
  for (const ch of cmd) {
    if (q) {
      if (ch === q) q = null;
      else cur += ch;
    } else if (ch === "'" || ch === '"') {
      q = ch;
      has = true;
    } else if (/\s/.test(ch)) {
      if (has || cur) out.push(cur);
      cur = '';
      has = false;
    } else if (/[|&;<>()`$*?\\]/.test(ch)) {
      return null; // pipes, redirections, substitutions…: not a plain script call
    } else {
      cur += ch;
    }
  }
  if (q) return null;
  if (has || cur) out.push(cur);
  return out;
}

/**
 * Finds the status line script. Returns { script } or { error, hint } or { none: true }.
 */
export function locateScript(settings) {
  if (SCRIPT_OVERRIDE) return { script: path.resolve(SCRIPT_OVERRIDE) };
  const sl = settings.statusLine;
  if (sl === undefined || sl === null) return { none: true };
  if (typeof sl !== 'object' || sl.type !== 'command' || typeof sl.command !== 'string' || !sl.command.trim()) {
    return { error: 'statusLine n\'est pas une commande ({"type":"command","command":"…"}).' };
  }
  const w = words(sl.command.trim());
  if (!w || !w.length) return { error: `La commande de la status line n'est pas un simple appel de script : ${sl.command}` };
  let file;
  let viaShell = false;
  if (SHELLS.test(w[0]) && w.length === 2) {
    file = w[1];
    viaShell = true;
  } else if (w.length === 1) {
    file = w[0];
  } else {
    return { error: `La commande de la status line n'est pas un simple appel de script : ${sl.command}` };
  }
  file = expandHome(file);
  if (!path.isAbsolute(file)) return { error: `Chemin de script relatif, non modifiable sans ambiguïté : ${file}` };
  let st;
  try {
    st = fs.statSync(file);
  } catch {
    return { error: `Script de status line introuvable : ${file}` };
  }
  if (!st.isFile()) return { error: `${file} n'est pas un fichier.` };
  if (st.size > 1024 * 1024) return { error: `${file} est trop gros pour être un script shell.` };
  if (!viaShell) {
    const head = fs.readFileSync(file, 'utf8').split('\n', 1)[0];
    if (!/^#!\s*(?:\/usr\/bin\/env\s+)?\S*\b(sh|bash|zsh|dash)\b/.test(head)) {
      return { error: `${file} n'est pas un script sh/bash (shebang : ${head || 'aucun'}).` };
    }
  }
  return { script: file };
}

export function lineFor(indent = '') {
  return `${indent}printf '%s' "$input" | ${shQuote(STATUSLINE_SCRIPT)} >/dev/null 2>&1 || true # ${STATUSLINE_MARKER}`;
}

const INPUT_RE = /^([ \t]*)input=(?:\$\(cat\)|"\$\(cat\)")[ \t]*(?:#.*)?$/;

export function isOurLine(line) {
  return line.includes(`# ${STATUSLINE_MARKER}`) && !line.includes(CREATED_MARKER);
}

/** Returns the script text without our line(s). */
export function stripLine(text) {
  return text.split('\n').filter((l) => !isOurLine(l)).join('\n');
}

/** Returns { text } with our line right after `input=$(cat)`, or { error } if there is no such line. */
export function insertLine(text) {
  const lines = stripLine(text).split('\n');
  const i = lines.findIndex((l) => INPUT_RE.test(l));
  if (i < 0) return { error: 'no-input' };
  const indent = INPUT_RE.exec(lines[i])[1];
  lines.splice(i + 1, 0, lineFor(indent));
  return { text: lines.join('\n') };
}

/** Writes atomically, keeping the file mode, after a .bak-lotr backup of the previous content. */
export function writeScript(file, text) {
  const mode = fs.statSync(file).mode & 0o7777;
  fs.copyFileSync(file, file + '.bak-lotr');
  const tmp = file + '.tmp-lotr';
  fs.writeFileSync(tmp, text, { mode });
  fs.chmodSync(tmp, mode);
  fs.renameSync(tmp, file);
}

export function minimalScript() {
  return `#!/bin/sh
# Status line minimale installée par la Carte de la Terre du Milieu (${CREATED_MARKER}).
# Affiche le modèle et le contexte utilisé, et transmet les données d'usage à la carte.
input=$(cat)
${lineFor()}
if command -v jq >/dev/null 2>&1; then
  printf '%s' "$input" | jq -r '"\\(.model.display_name // "Claude") · Ctx \\((.context_window.used_percentage // 0) | floor)%"' 2>/dev/null
else
  echo "Claude"
fi
`;
}
