'use strict';
/**
 * In-memory state of the Middle-earth map.
 *
 * - agents: Map<id, agent> — sessions (one per Claude Code session) and their subagents
 * - chronicle: themed, human readable feed generated from hook events
 * - council: inter-agent conversations (subagent spawn / return, SendMessage)
 *
 * Every hook payload is sanitized (truncated) before being stored or persisted.
 * The store emits 'broadcast' (type, data) events that the HTTP server relays over SSE.
 */
const fs = require('node:fs');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const U = require('./usage');
const { subagentTranscriptPath } = require('./transcripts');

const TERRITORIES = [
  { key: 'shire', name: 'La Comté', where: 'dans la Comté' },
  { key: 'bree', name: 'Bree', where: 'à Bree' },
  { key: 'rivendell', name: 'Fondcombe', where: 'à Fondcombe' },
  { key: 'moria', name: 'La Moria', where: 'dans la Moria' },
  { key: 'lorien', name: 'La Lothlórien', where: 'en Lothlórien' },
  { key: 'isengard', name: 'Isengard', where: 'à Isengard' },
  { key: 'rohan', name: 'Le Rohan', where: 'au Rohan' },
  { key: 'gondor', name: 'Le Gondor', where: 'au Gondor' },
  { key: 'mordor', name: 'Le Mordor', where: 'au Mordor' },
  { key: 'erebor', name: 'Erebor', where: 'à Erebor' },
];
const TERR_BY_KEY = Object.fromEntries(TERRITORIES.map((t) => [t.key, t]));

const MAX_PERSIST = 500;
const IDLE_TO_DONE_MS = 30 * 60 * 1000;
const DONE_TO_GONE_MS = 2 * 60 * 60 * 1000;
const SUBAGENT_LINGER_MS = 3 * 60 * 1000;
const MAX_ACTIONS = 15;
const MAX_CHRONICLE = 300;
const MAX_COUNCIL = 150;
const MAX_SUBAGENT_LOG = 20;
const MAX_PENDING_USAGE = 100;
const PENDING_USAGE_TTL_MS = 30 * 60 * 1000;

const ROLE_NAMES = {
  hobbit: 'hobbit',
  dwarf: 'nain',
  wizard: 'magicien',
  scout: 'elfe éclaireur',
  painter: 'elfe artiste',
  troll: 'troll',
};

// Character that performs a given kind of work (used in the chronicle).
const CHAR = {
  coding: 'Le nain',
  think: 'Le magicien',
  research: "L'elfe éclaireur",
  designing: "L'elfe artiste",
  running: 'Le troll',
  talking: 'Le hobbit',
};

// ---------------------------------------------------------------- helpers

function str(v) {
  if (typeof v === 'string') return v;
  if (v == null) return '';
  if (typeof v === 'object') return safeJson(v);
  return String(v);
}

function clip(v, n) {
  const s = str(v);
  return s.length > n ? s.slice(0, Math.max(0, n - 1)) + '…' : s;
}

function oneLine(v) {
  return str(v).replace(/\s+/g, ' ').trim();
}

function safeJson(v) {
  try {
    return JSON.stringify(v);
  } catch {
    return '';
  }
}

function baseName(p) {
  const s = str(p).replace(/[\\/]+$/, '');
  const i = Math.max(s.lastIndexOf('/'), s.lastIndexOf('\\'));
  return i >= 0 ? s.slice(i + 1) : s;
}

function shortDir(p) {
  const s = str(p).replace(/[\\/]+$/, '');
  if (!s) return '';
  const parts = s.split(/[\\/]/).filter(Boolean);
  return clip(parts.slice(-2).join('/') + '/', 28);
}

function hostOf(url) {
  try {
    return new URL(str(url)).host || clip(url, 30);
  } catch {
    return clip(url, 30) || 'une contrée lointaine';
  }
}

function hashStr(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function pick(arr, n) {
  return arr[Math.abs(n | 0) % arr.length];
}

function roleFor(type) {
  const t = str(type).toLowerCase();
  if (/architect|review|critic|audit|advis|plan|wizard|judge/.test(t)) return 'wizard';
  if (/design|frontend|artist|figma|(^|[^a-z])(ui|ux)([^a-z]|$)/.test(t)) return 'painter';
  if (/research|explor|search|scout|investig|analy|librar/.test(t)) return 'scout';
  if (/test|bash|shell|runner|deploy|devops|(^|[^a-z])(qa|ci)([^a-z]|$)/.test(t)) return 'troll';
  return 'dwarf';
}

function isDesignName(name) {
  return /design|frontend|artifact|figma|canvas|(^|[^a-z])(ui|ux)([^a-z]|$)/i.test(str(name));
}

function frMessage(m) {
  const s = oneLine(m);
  let r;
  if ((r = /needs your permission to use (.+)$/i.exec(s))) return `Demande la permission d'utiliser ${r[1]}`;
  if (/waiting for your input/i.test(s)) return 'Attend ta réponse';
  if (/needs your attention/i.test(s)) return 'Réclame ton attention';
  return s || 'Attend ta réponse';
}

// ---------------------------------------------------------------- sanitizing

// Per-key length limits for tool_input. 0 = drop the value, keep only its size.
const INPUT_LIMITS = {
  file_path: 300,
  notebook_path: 300,
  path: 300,
  command: 300,
  pattern: 160,
  glob: 160,
  query: 200,
  url: 300,
  description: 240,
  subagent_type: 80,
  prompt: 500,
  to: 120,
  recipient: 120,
  target: 120,
  message: 300,
  summary: 200,
  plan: 300,
  skill: 80,
  name: 120,
  type: 60,
  old_string: 0,
  new_string: 0,
  content: 0,
  edits: 0,
  todos: 0,
  new_source: 0,
};

function sanitizeInput(input) {
  if (input == null) return undefined;
  if (typeof input !== 'object') return clip(input, 200);
  if (Array.isArray(input)) return clip(safeJson(input), 200);
  const out = {};
  let extra = 0;
  for (const [k, v] of Object.entries(input)) {
    if (Object.prototype.hasOwnProperty.call(INPUT_LIMITS, k)) {
      const lim = INPUT_LIMITS[k];
      if (lim === 0) {
        if (typeof v === 'string') out[k + '_length'] = v.length;
        else if (Array.isArray(v)) out[k + '_count'] = v.length;
        continue;
      }
      if (typeof v === 'number' || typeof v === 'boolean') out[k] = v;
      else out[k] = clip(v, lim);
    } else if (k === 'questions' && Array.isArray(v)) {
      out.questions = v.slice(0, 4).map((q) => ({
        question: clip(q && typeof q === 'object' ? q.question || q.header : q, 200),
      }));
    } else if (extra < 6 && ['string', 'number', 'boolean'].includes(typeof v)) {
      out[k] = typeof v === 'string' ? clip(v, 120) : v;
      extra++;
    }
  }
  return out;
}

function responseText(resp) {
  if (resp == null) return '';
  if (typeof resp === 'string') return resp;
  if (Array.isArray(resp)) return resp.map(responseText).join(' ');
  if (typeof resp === 'object') {
    if (Array.isArray(resp.content)) {
      return resp.content.map((c) => (c && typeof c === 'object' ? str(c.text) : str(c))).join(' ');
    }
    for (const k of ['result', 'text', 'output', 'message', 'summary']) {
      if (typeof resp[k] === 'string') return resp[k];
    }
    return safeJson(resp);
  }
  return String(resp);
}

function sanitizeResponse(tool, resp) {
  if (resp == null) return undefined;
  if (tool === 'Agent' || tool === 'Task') return { text: clip(oneLine(responseText(resp)), 600) };
  if (typeof resp === 'object' && (resp.is_error || resp.interrupted || resp.success === false)) {
    return { error: true };
  }
  return undefined;
}

const STRING_FIELDS = {
  cwd: 400,
  transcript_path: 400,
  tool_name: 120,
  tool_use_id: 120,
  message: 500,
  prompt: 600,
  agent_id: 120,
  agent_type: 80,
  notification_type: 60,
  source: 40,
  reason: 60,
  title: 200,
  agent_transcript_path: 400,
};

// Origin of a session (where it runs: terminal tab, desktop app, editor), from the hook's
// X-LOTR-Origin header (or an `origin` object). Strict whitelist: each field must match its pattern,
// anything else is dropped. Used by the macOS app to bring the real session to the front.
const ORIGIN_FIELDS = {
  entrypoint: /^[a-z0-9_-]{1,32}$/,
  hostSessionId: /^local_[A-Za-z0-9-]{1,64}$/,
  termProgram: /^[A-Za-z0-9._-]{1,64}$/,
  bundleId: /^[A-Za-z0-9.-]{1,128}$/,
  itermSessionId: /^[A-Za-z0-9:-]{1,80}$/,
  tty: /^\/dev\/ttys[0-9]{1,4}$/,
  claudePid: /^[0-9]{1,10}$/,
};

/** Keeps only the valid whitelisted fields; null when nothing is left. Never throws. */
function sanitizeOrigin(o) {
  if (!o || typeof o !== 'object' || Array.isArray(o)) return null;
  const out = {};
  for (const [k, re] of Object.entries(ORIGIN_FIELDS)) {
    if (!Object.prototype.hasOwnProperty.call(o, k)) continue;
    const v = typeof o[k] === 'number' && Number.isInteger(o[k]) ? String(o[k]) : o[k];
    if (typeof v === 'string' && re.test(v)) out[k] = k === 'claudePid' ? Number(v) : v;
  }
  if (out.claudePid !== undefined && !(out.claudePid > 1)) delete out.claudePid;
  return Object.keys(out).length ? out : null;
}

/** Parses the X-LOTR-Origin header (k=v&k=v). */
function parseOriginHeader(h) {
  if (typeof h !== 'string' || !h || h.length > 1024) return null;
  const o = {};
  for (const part of h.split('&')) {
    const i = part.indexOf('=');
    if (i <= 0) continue;
    const k = part.slice(0, i);
    if (Object.prototype.hasOwnProperty.call(ORIGIN_FIELDS, k) && !(k in o)) o[k] = part.slice(i + 1);
  }
  return sanitizeOrigin(o);
}

/** Normalizes a raw hook payload into a small, safe event object. Never throws. */
function sanitizeEvent(raw, hookHint, opts = {}) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) raw = {};
  const hook = clip(hookHint || raw.hook_event_name || raw.hookEventName || 'Unknown', 40);
  const ts = opts.replay && Number.isFinite(raw.ts) ? raw.ts : opts.ts || Date.now();
  const ev = { ts, hook };
  ev.session_id = clip(raw.session_id || raw.sessionId || 'session-inconnue', 120);
  for (const [k, lim] of Object.entries(STRING_FIELDS)) {
    if (raw[k] != null && raw[k] !== '') ev[k] = clip(raw[k], lim);
  }
  // Some payloads use subagent_type instead of agent_type.
  if (!ev.agent_type && raw.subagent_type) ev.agent_type = clip(raw.subagent_type, 80);
  if (raw.tool_input !== undefined) {
    const i = sanitizeInput(raw.tool_input);
    if (i !== undefined) ev.tool_input = i;
  }
  if (raw.tool_response !== undefined) {
    const r = opts.replay && raw.tool_response && typeof raw.tool_response === 'object' && ('text' in raw.tool_response || 'error' in raw.tool_response)
      ? raw.tool_response
      : sanitizeResponse(ev.tool_name, raw.tool_response);
    if (r) ev.tool_response = r;
  }
  const origin = sanitizeOrigin(raw.origin);
  if (origin) ev.origin = origin;
  if (opts.demo || raw.demo === true) ev.demo = true;
  return ev;
}

// ---------------------------------------------------------------- tool description

function mk(status, activity, short, icon, chron) {
  return { status, activity, short, icon, chron };
}

/**
 * Maps a tool call to a status + short action (speech bubble) + themed chronicle line.
 */
function describeTool(tool, input, actor, project) {
  const i = input && typeof input === 'object' ? input : {};
  const tag = actor.kind === 'subagent' ? ` (${actor.subagentType})` : '';
  const S = (kind) => `${CHAR[kind]} de ${project}${tag}`;
  const file = baseName(i.file_path || i.notebook_path) || 'un parchemin';
  const n = actor.counters[tool] || 1;
  let r;
  switch (tool) {
    case 'Edit':
    case 'MultiEdit':
      r = mk('coding', null, `Édite ${file}`, '⚒', `${S('coding')} ${pick(['forge', 'martèle', 'affûte', 'retrempe'], n)} ${file}`);
      break;
    case 'Write':
      r = mk('coding', null, `Écrit ${file}`, '⚒', `${S('coding')} coule ${file} dans l'acier neuf`);
      break;
    case 'NotebookEdit':
      r = mk('coding', null, `Édite ${file}`, '⚒', `${S('coding')} grave des runes dans ${file}`);
      break;
    case 'Read':
      r = n % 5 === 0
        ? mk('thinking', 'think', `Lit ${file}`, '🧙', `${S('think')} médite sur ${n} parchemins`)
        : mk('thinking', 'think', `Lit ${file}`, '📜', `${S('think')} déchiffre ${file}`);
      break;
    case 'Grep': {
      const pat = clip(i.pattern, 30) || '?';
      const dir = shortDir(i.path || i.glob);
      r = mk('thinking', 'research', `Cherche '${clip(pat, 18)}'${dir ? ' dans ' + dir : ''}`, '🔍', `${S('research')} traque « ${pat} »${dir ? ' dans ' + dir : ''}`);
      break;
    }
    case 'Glob':
      r = mk('thinking', 'research', `Explore ${clip(i.pattern, 24)}`, '🗺', `${S('research')} arpente les sentiers ${clip(i.pattern, 40)}`);
      break;
    case 'LS':
      r = mk('thinking', 'research', `Explore ${shortDir(i.path) || 'les environs'}`, '🗺', `${S('research')} inspecte ${shortDir(i.path) || 'les environs'}`);
      break;
    case 'WebSearch':
      r = mk('thinking', 'research', `Cherche : ${clip(i.query, 24)}`, '🧝', `${S('research')} interroge les étoiles : « ${clip(i.query, 60)} »`);
      break;
    case 'WebFetch': {
      const host = hostOf(i.url);
      r = mk('thinking', 'research', `Consulte ${clip(host, 22)}`, '🕊', `${S('research')} consulte les archives de ${host}`);
      break;
    }
    case 'Bash': {
      const full = oneLine(i.command);
      const cmd = clip(full, 60) || '…';
      const short = `Lance ${clip(full, 24)}`;
      if (/\b(test|tests|jest|vitest|pytest|mocha|spec|playwright|cypress)\b/i.test(full)) {
        r = mk('running', null, short, '🧌', `${S('running')} met les tests à l'épreuve : ${cmd}`);
      } else if (/\bgit\b/.test(full)) {
        r = mk('running', null, short, '📯', `${S('running')} sonne le cor de git : ${cmd}`);
      } else if (/\b(npm|pnpm|yarn|bun|pip|cargo) (i|install|add)\b/.test(full)) {
        r = mk('running', null, short, '📦', `${S('running')} charge les poneys : ${cmd}`);
      } else if (/build|tsc|lint|make|webpack|vite|cargo/.test(full)) {
        r = mk('running', null, short, '🪨', `${S('running')} concasse des rochers : ${cmd}`);
      } else {
        r = mk('running', null, short, '🪨', `${S('running')} cogne sur un rocher : ${cmd}`);
      }
      break;
    }
    case 'BashOutput':
    case 'KillShell':
    case 'KillBash':
      r = mk('running', null, 'Surveille un processus', '🪨', `${S('running')} guette le grondement d'un processus`);
      break;
    case 'TodoWrite': {
      const count = i.todos_count;
      r = mk('thinking', 'think', 'Dresse la liste des tâches', '🧙', `${S('think')} dresse le plan de bataille${count ? ` (${count} tâches)` : ''}`);
      break;
    }
    case 'AskUserQuestion': {
      const q = (i.questions && i.questions[0] && i.questions[0].question) || 'Une question';
      r = mk('waiting', null, 'Te pose une question', '🔥', `Les feux d'alarme sont allumés ! ${project}${tag} te demande : « ${clip(q, 90)} »`);
      r.waitMessage = clip(q, 200);
      break;
    }
    case 'ExitPlanMode':
      r = mk('waiting', null, 'Propose un plan', '🔥', `Les feux d'alarme sont allumés ! ${project}${tag} déroule un plan et attend ton approbation`);
      r.waitMessage = 'Plan à approuver';
      break;
    case 'Skill': {
      const skill = clip(i.skill || i.name || 'inconnu', 40);
      r = mk('thinking', 'think', `Invoque ${clip(skill, 20)}`, '✨', `${S('think')} récite le grimoire « ${skill} »`);
      break;
    }
    default:
      if (tool.startsWith('mcp__')) {
        const parts = tool.split('__');
        const server = parts[1] || '?';
        const name = parts.slice(2).join('__');
        r = mk('thinking', 'think', `Palantír ${clip(server, 16)}`, '🔮', `${S('think')} consulte le palantír ${server}${name ? ' (' + name + ')' : ''}`);
      } else {
        r = mk('thinking', 'think', `Utilise ${clip(tool, 20)}`, '✨', `${S('think')} manie l'artefact ${tool}`);
      }
  }
  // Design work: tool name or painter subagent.
  if (r.status !== 'waiting' && (isDesignName(tool) || (actor.role === 'painter' && r.status !== 'running'))) {
    const subject = i.file_path || i.notebook_path ? file : clip(i.query || i.pattern || i.description || 'une nouvelle vision', 40);
    r.status = 'designing';
    r.activity = null;
    r.icon = '🎨';
    r.chron = r.short.startsWith('Lit') || r.short.startsWith('Cherche') || r.short.startsWith('Explore')
      ? `${S('designing')} cherche l'inspiration dans ${subject}`
      : `${S('designing')} peint ${subject}`;
  }
  return r;
}

// ---------------------------------------------------------------- store

class Store extends EventEmitter {
  constructor(opts = {}) {
    super();
    this.file = opts.file || null;
    this.agents = new Map();
    this.chronicle = [];
    this.council = [];
    this.persisted = [];
    this.silent = false;
    this.seq = 0;
    this.logSeq = 0;
    this.clock = Date.now();
    this.linesInFile = 0;
    this.demoActive = false;
    this.dirReady = false;
    this.warned = false;
    // Usage (status line + transcripts). Real and demo values are kept apart, demo never overwrites real.
    this.usage = { real: this.newUsage(), demo: this.newUsage() };
    this.pendingUsage = new Map(); // status line of a session not seen through hooks yet
    this.transcripts = null;
    this.usageTimer = null;
    this.usageSaveTimer = null;
    this.usageFile = this.file ? path.join(path.dirname(this.file), 'usage-state.json') : null;
  }

  newUsage() {
    return {
      five: null,
      seven: null,
      watch: { five: U.newWatch(), seven: U.newWatch() },
      daily: new Map(), // day -> tokens
      costs: new Map(), // sessionId -> { usd, day }
    };
  }

  // ------------------------------------------------ persistence

  load() {
    if (!this.file) return 0;
    let text;
    try {
      text = fs.readFileSync(this.file, 'utf8');
    } catch {
      return 0;
    }
    const events = [];
    for (const line of text.split('\n').filter(Boolean).slice(-MAX_PERSIST)) {
      try {
        const ev = JSON.parse(line);
        if (ev && typeof ev === 'object' && !Array.isArray(ev)) events.push(ev);
      } catch {
        /* ignore corrupt line */
      }
    }
    this.silent = true;
    for (const ev of events) {
      try {
        this.ingest(ev, { replay: true, hook: ev.hook });
      } catch {
        /* ignore */
      }
    }
    this.silent = false;
    this.compact();
    this.sweep(Date.now());
    return events.length;
  }

  /** Restores the real limits + announced thresholds (so a restart does not repeat the chronicle). */
  loadUsageState() {
    if (!this.usageFile) return;
    try {
      const d = JSON.parse(fs.readFileSync(this.usageFile, 'utf8'));
      const u = this.usage.real;
      for (const k of ['five', 'seven']) {
        const v = d && d[k];
        if (v && typeof v === 'object') u[k] = { pct: Number.isFinite(v.pct) ? v.pct : null, resetsAt: Number.isFinite(v.resetsAt) ? v.resetsAt : null, at: Number(v.at) || 0 };
        const w = d && d.watch && d.watch[k];
        if (w && typeof w === 'object') {
          u.watch[k] = {
            window: Number.isFinite(w.window) ? w.window : null,
            done: Array.isArray(w.done) ? w.done.filter(Number.isFinite) : [],
            lastPct: Number.isFinite(w.lastPct) ? w.lastPct : null,
          };
        }
      }
    } catch {
      /* no state yet */
    }
  }

  saveUsageState() {
    if (!this.usageFile || this.usageSaveTimer) return;
    this.usageSaveTimer = setTimeout(() => {
      this.usageSaveTimer = null;
      const u = this.usage.real;
      try {
        this.ensureDir();
        const tmp = this.usageFile + '.tmp';
        fs.writeFileSync(tmp, JSON.stringify({ five: u.five, seven: u.seven, watch: u.watch }));
        fs.renameSync(tmp, this.usageFile);
      } catch {
        /* ignore */
      }
    }, 2000);
    if (this.usageSaveTimer.unref) this.usageSaveTimer.unref();
  }

  ensureDir() {
    if (this.dirReady || !this.file) return;
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    this.dirReady = true;
  }

  append(ev) {
    if (!this.file) return;
    try {
      this.ensureDir();
      fs.appendFileSync(this.file, JSON.stringify(ev) + '\n');
      this.linesInFile++;
      if (this.linesInFile > MAX_PERSIST + 100) this.compact();
    } catch (e) {
      if (!this.warned) {
        this.warned = true;
        console.warn('[lotr] impossible d\'écrire', this.file, e.message);
      }
    }
  }

  compact() {
    if (!this.file) return;
    try {
      this.ensureDir();
      const tmp = this.file + '.tmp';
      const body = this.persisted.map((e) => JSON.stringify(e)).join('\n');
      fs.writeFileSync(tmp, body ? body + '\n' : '');
      fs.renameSync(tmp, this.file);
      this.linesInFile = this.persisted.length;
    } catch {
      /* ignore */
    }
  }

  // ------------------------------------------------ ingestion

  /** Ingests a raw hook payload. Returns the sanitized event. */
  ingest(raw, opts = {}) {
    const ev = sanitizeEvent(raw, opts.hook, { demo: opts.demo, replay: opts.replay });
    if (!ev.demo) {
      this.persisted.push(ev);
      if (this.persisted.length > MAX_PERSIST) this.persisted.splice(0, this.persisted.length - MAX_PERSIST);
      if (!opts.replay) this.append(ev);
    }
    this.apply(ev);
    return ev;
  }

  apply(ev) {
    this.clock = ev.ts;
    const session = this.ensureSession(ev);
    const actor = ev.hook === 'SubagentStop' ? session : this.resolveActor(session, ev);
    session.lastSeen = ev.ts;
    actor.lastSeen = ev.ts;
    const changed = new Set([session, actor]);

    switch (ev.hook) {
      case 'SessionStart': {
        this.clearWaiting(session);
        this.setStatus(session, 'idle');
        this.addAction(session, session, 'Arrive en Terre du Milieu', 'SessionStart', 'idle');
        const t = TERR_BY_KEY[session.territory];
        this.log('chronicle', session, '🌄', `Une nouvelle compagnie s'éveille ${t ? t.where : ''} : ${session.project}`, 'start');
        break;
      }
      case 'UserPromptSubmit': {
        this.clearWaiting(session, true);
        session.lastPrompt = clip(oneLine(ev.prompt), 240);
        this.setStatus(session, 'thinking', 'think');
        this.addAction(session, session, 'Reçoit une nouvelle quête', 'Prompt', 'thinking');
        this.log('chronicle', session, '🧭', `Une nouvelle quête pour ${session.project} : « ${clip(oneLine(ev.prompt), 90) || '…'} »`, 'prompt');
        break;
      }
      case 'PreToolUse':
        this.clearWaiting(actor, true);
        if (actor !== session) this.clearWaiting(session, true);
        this.onTool(session, actor, ev, changed);
        break;
      case 'PostToolUse':
        this.clearWaiting(actor, true);
        if (actor !== session) this.clearWaiting(session, true);
        this.onToolDone(session, actor, ev, changed);
        break;
      case 'Notification':
        this.onNotification(session, actor, ev);
        break;
      case 'Stop':
        this.clearWaiting(session, true);
        this.setStatus(session, 'idle');
        this.addAction(session, session, 'Se repose au coin du feu', 'Stop', 'idle');
        this.log('chronicle', session, '🏕', `${session.project} pose son sac et se repose au coin du feu`, 'idle');
        break;
      case 'SubagentStop':
        this.onSubagentStop(session, ev, changed);
        break;
      case 'SessionEnd':
        this.endSession(session, 'end');
        break;
      default:
        break;
    }
    this.watchTranscripts(session, actor, ev);
    for (const a of changed) if (this.agents.has(a.id)) this.push(a);
  }

  newAgent(f) {
    return {
      id: f.id,
      kind: f.kind,
      sessionId: f.sessionId,
      parentId: f.parentId || null,
      role: f.role,
      subagentType: f.subagentType || null,
      project: f.project || '',
      cwd: f.cwd || '',
      territory: f.territory || null,
      status: 'idle',
      prevStatus: null,
      activity: null,
      lastPrompt: '',
      lastAction: '',
      lastActionAt: 0,
      description: '',
      prompt: '',
      result: '',
      actions: [],
      counters: {},
      toolCount: 0,
      startedAt: f.ts,
      lastSeen: f.ts,
      doneAt: null,
      waiting: null,
      demo: !!f.demo,
      agentId: null,
      toolUseId: null,
      subagents: f.kind === 'session' ? [] : undefined,
      subagentTotal: 0,
      usage: null, // from the status line (sessions)
      origin: null, // sessions: where it runs (sanitizeOrigin), for "go to this session"
      tokens: null, // from the transcript
      subTokens: null, // sum of the subagents' tokens (sessions)
    };
  }

  ensureSession(ev) {
    let s = this.agents.get(ev.session_id);
    if (!s) {
      s = this.newAgent({ id: ev.session_id, kind: 'session', sessionId: ev.session_id, role: 'hobbit', ts: ev.ts, demo: ev.demo });
      this.agents.set(s.id, s);
      const pending = this.pendingUsage.get(s.id);
      if (pending) {
        this.pendingUsage.delete(s.id);
        if (!!pending.demo === !!s.demo && ev.ts - pending.at < PENDING_USAGE_TTL_MS) {
          this.applySessionUsage(s, pending.per, false);
          if (!s.transcriptPath && pending.transcript_path) s.transcriptPath = pending.transcript_path;
        }
      }
    }
    if (ev.cwd) {
      s.cwd = ev.cwd;
      s.project = baseName(ev.cwd) || s.project;
    }
    if (!s.project) s.project = 'Compagnie-' + s.id.slice(0, 6);
    if (ev.transcript_path) s.transcriptPath = ev.transcript_path;
    if (ev.origin) s.origin = ev.origin; // last non-empty value
    if (s.status === 'done' && ev.hook !== 'SessionEnd' && ev.hook !== 'SubagentStop') {
      // A sleeping company wakes up again.
      s.status = 'idle';
      s.doneAt = null;
    }
    if (s.status !== 'done') this.assignTerritory(s);
    return s;
  }

  assignTerritory(s) {
    const occupied = new Set();
    for (const a of this.agents.values()) {
      if (a.kind === 'session' && a !== s && a.status !== 'done' && a.territory) occupied.add(a.territory);
    }
    if (s.territory && !occupied.has(s.territory)) return;
    const n = TERRITORIES.length;
    const start = hashStr(s.id) % n;
    let chosen = TERRITORIES[start].key; // all taken: share with someone
    for (let k = 0; k < n; k++) {
      const t = TERRITORIES[(start + k) % n].key;
      if (!occupied.has(t)) {
        chosen = t;
        break;
      }
    }
    s.territory = chosen;
    for (const c of this.childrenOf(s.id)) c.territory = chosen;
  }

  childrenOf(sessionId) {
    const out = [];
    for (const a of this.agents.values()) if (a.kind === 'subagent' && a.sessionId === sessionId) out.push(a);
    return out.sort((a, b) => a.startedAt - b.startedAt);
  }

  resolveActor(session, ev) {
    const aid = ev.agent_id;
    if (!aid || aid === session.id) return session;
    const children = this.childrenOf(session.id);
    let c = children.find((a) => a.agentId === aid);
    if (c) return c;
    const type = ev.agent_type;
    c = children.find((a) => !a.agentId && a.status !== 'done' && (!type || a.subagentType === type))
      || children.find((a) => !a.agentId && a.status !== 'done');
    if (c) {
      c.agentId = aid;
      return c;
    }
    // Subagent never seen being spawned (e.g. server started mid-flight).
    c = this.spawnChild(session, session, { type: type || 'sous-agent', ts: ev.ts, demo: ev.demo });
    c.agentId = aid;
    return c;
  }

  spawnChild(session, parent, o) {
    const id = `${session.id}::${o.toolUseId || 'sub' + ++this.seq}`;
    const existing = this.agents.get(id);
    if (existing) return existing;
    const role = roleFor(o.type);
    const c = this.newAgent({
      id,
      kind: 'subagent',
      sessionId: session.id,
      parentId: parent.id,
      role,
      subagentType: clip(o.type, 60),
      project: session.project,
      cwd: session.cwd,
      territory: session.territory,
      ts: o.ts,
      demo: o.demo,
    });
    c.description = clip(oneLine(o.description), 200);
    c.prompt = clip(oneLine(o.prompt), 400);
    c.toolUseId = o.toolUseId || null;
    if (role === 'painter') this.setStatus(c, 'designing');
    else if (role === 'scout') this.setStatus(c, 'thinking', 'research');
    else if (role === 'troll') this.setStatus(c, 'running');
    else if (role === 'dwarf') this.setStatus(c, 'coding');
    else this.setStatus(c, 'thinking', 'think');
    c.lastAction = 'Part en mission';
    c.lastActionAt = o.ts;
    this.agents.set(id, c);
    session.subagentTotal = (session.subagentTotal || 0) + 1;
    session.subagents.unshift({
      id,
      type: c.subagentType,
      role,
      description: c.description,
      status: c.status,
      startedAt: o.ts,
      endedAt: null,
      result: '',
    });
    if (session.subagents.length > MAX_SUBAGENT_LOG) session.subagents.length = MAX_SUBAGENT_LOG;
    return c;
  }

  setStatus(a, status, activity) {
    if (status === 'waiting' && a.status !== 'waiting') a.prevStatus = a.status;
    a.status = status;
    a.activity = activity || null;
  }

  clearWaiting(a, announce) {
    if (!a.waiting && a.status !== 'waiting') return;
    const was = !!a.waiting;
    a.waiting = null;
    if (a.status === 'waiting') {
      a.status = a.prevStatus && a.prevStatus !== 'waiting' && a.prevStatus !== 'done' ? a.prevStatus : 'thinking';
    }
    if (was && announce) {
      this.log('chronicle', a, '✅', `La balise de ${a.project} s'éteint : la compagnie reprend la route`, 'resume');
    }
  }

  addAction(session, actor, text, tool, status) {
    const entry = { t: this.clock, text: clip(text, 120), tool, status, who: actor.kind === 'subagent' ? actor.subagentType : null };
    actor.actions.unshift(entry);
    if (actor.actions.length > MAX_ACTIONS) actor.actions.length = MAX_ACTIONS;
    actor.lastAction = entry.text;
    actor.lastActionAt = this.clock;
    if (actor !== session) {
      session.actions.unshift({ ...entry });
      if (session.actions.length > MAX_ACTIONS) session.actions.length = MAX_ACTIONS;
    }
  }

  label(a) {
    return a.kind === 'subagent' ? `${a.project} · ${a.subagentType}` : a.project;
  }

  onTool(session, actor, ev, changed) {
    const tool = ev.tool_name || 'Outil';
    const input = ev.tool_input && typeof ev.tool_input === 'object' ? ev.tool_input : {};
    actor.counters[tool] = (actor.counters[tool] || 0) + 1;
    actor.toolCount++;
    if (tool === 'Agent' || tool === 'Task') return this.onSpawn(session, actor, ev, input, changed);
    if (tool === 'SendMessage') return this.onSendMessage(session, actor, ev, input, changed);

    const d = describeTool(tool, input, actor, session.project);
    if (d.status === 'waiting') {
      actor.waiting = { message: d.waitMessage || d.short, since: this.clock, kind: tool };
    }
    this.setStatus(actor, d.status, d.activity);
    this.addAction(session, actor, d.short, tool, d.status);
    this.log('chronicle', actor, d.icon, d.chron, d.status === 'waiting' ? 'alert' : 'tool', { tool: clip(tool, 60) });
  }

  onSpawn(session, actor, ev, input, changed) {
    const type = clip(input.subagent_type || 'general-purpose', 60);
    const desc = oneLine(input.description) || 'une mission secrète';
    const child = this.spawnChild(session, actor, {
      type,
      description: desc,
      prompt: input.prompt,
      toolUseId: ev.tool_use_id,
      ts: ev.ts,
      demo: ev.demo,
    });
    changed.add(child);
    this.setStatus(actor, 'talking');
    this.addAction(session, actor, `Délègue à ${type} : ${clip(desc, 40)}`, ev.tool_name, 'talking');
    this.log('council', actor, '📜', clip(desc, 140), 'spawn', {
      from: this.label(actor),
      to: this.label(child),
      body: clip(oneLine(input.prompt), 400),
      childId: child.id,
    });
    this.log('chronicle', actor, '🚶', `${session.project} envoie un ${ROLE_NAMES[child.role]} (${type}) en mission : ${clip(desc, 70)}`, 'spawn');
  }

  onSendMessage(session, actor, ev, input, changed) {
    const to = oneLine(input.to || input.recipient || input.target || input.name);
    const target = this.findAgentByName(to, actor);
    const toLabel = target ? this.label(target) : to || 'quelque part';
    this.setStatus(actor, 'talking');
    this.addAction(session, actor, `Message à ${clip(toLabel, 24)}`, 'SendMessage', 'talking');
    this.log('council', actor, '🦅', `Message pour ${toLabel}`, 'message', {
      from: this.label(actor),
      to: toLabel,
      body: clip(oneLine(input.message || input.content || input.summary), 300),
    });
    this.log('chronicle', actor, '🦅', `Un aigle porte un message de ${this.label(actor)} à ${toLabel}`, 'message');
    this.fx({ type: 'eagle', from: actor.id, to: target ? target.id : null });
  }

  findAgentByName(name, self) {
    const n = str(name).toLowerCase().trim();
    if (!n) return null;
    let best = null;
    for (const a of this.agents.values()) {
      if (a === self || a.status === 'done') continue;
      const keys = [a.id, a.agentId, a.project, a.subagentType].filter(Boolean).map((k) => str(k).toLowerCase());
      if (keys.includes(n)) {
        if (!best || (a.kind === 'session' && best.kind !== 'session')) best = a;
      }
    }
    if (best) return best;
    for (const a of this.agents.values()) {
      if (a !== self && a.status !== 'done' && a.kind === 'session' && n.includes(a.project.toLowerCase())) return a;
    }
    return null;
  }

  onToolDone(session, actor, ev, changed) {
    const tool = ev.tool_name;
    if (tool !== 'Agent' && tool !== 'Task') return;
    const children = this.childrenOf(session.id);
    const id = ev.tool_use_id ? `${session.id}::${ev.tool_use_id}` : null;
    const type = ev.tool_input && ev.tool_input.subagent_type;
    const child = (id && this.agents.get(id))
      || children.find((c) => c.status !== 'done' && (!type || c.subagentType === type))
      || null;
    const result = ev.tool_response && ev.tool_response.text ? ev.tool_response.text : '';
    if (child) {
      if (result) child.result = clip(result, 600);
      if (child.status !== 'done') this.finishChild(child);
      changed.add(child);
      if (!child.returnLogged) {
        child.returnLogged = true;
        this.log('council', child, '🏁', `Rapport de mission : ${clip(child.description, 100)}`, 'return', {
          from: this.label(child),
          to: this.label(actor),
          body: clip(result, 400) || 'Mission accomplie.',
        });
      }
      this.setStatus(actor, 'thinking', 'think');
      this.addAction(session, actor, `Lit le rapport de ${child.subagentType}`, tool, 'thinking');
    }
  }

  finishChild(c) {
    this.clearWaiting(c);
    c.status = 'done';
    c.activity = null;
    c.doneAt = this.clock;
    c.lastAction = 'Revient de mission';
    c.lastActionAt = this.clock;
  }

  onSubagentStop(session, ev, changed) {
    const children = this.childrenOf(session.id).filter((c) => c.status !== 'done');
    const child = (ev.agent_id && children.find((c) => c.agentId === ev.agent_id))
      || (ev.agent_type && children.find((c) => !c.agentId && c.subagentType === ev.agent_type))
      || children.find((c) => !c.agentId)
      || children[0];
    if (!child) return;
    if (!child.agentId && ev.agent_id) child.agentId = ev.agent_id;
    if (ev.agent_transcript_path) child.transcriptPath = ev.agent_transcript_path;
    this.finishChild(child);
    changed.add(child);
    this.log('chronicle', child, '🏁', `Le ${ROLE_NAMES[child.role]} de ${session.project} (${child.subagentType}) revient de mission`, 'return');
  }

  onNotification(session, actor, ev) {
    const msg = clip(frMessage(ev.message), 300);
    actor.waiting = { message: msg, since: this.clock, kind: ev.notification_type || 'notification' };
    this.setStatus(actor, 'waiting');
    this.addAction(session, actor, msg, 'Notification', 'waiting');
    this.log('chronicle', actor, '🔥', `Les feux d'alarme sont allumés ! ${this.label(actor)} attend ta réponse : ${clip(msg, 100)}`, 'alert');
  }

  endSession(s, reason) {
    this.clearWaiting(s);
    s.status = 'done';
    s.activity = null;
    s.doneAt = this.clock;
    s.lastAction = reason === 'inactive' ? 'Endormi (inactif)' : 'A quitté la Terre du Milieu';
    s.lastActionAt = this.clock;
    for (const c of this.childrenOf(s.id)) {
      if (c.status !== 'done') {
        this.finishChild(c);
        this.push(c);
      }
    }
    this.log('chronicle', s, '🌅', reason === 'inactive'
      ? `${s.project} s'est endormi sous les étoiles (inactif depuis 30 min)`
      : `La compagnie de ${s.project} quitte la Terre du Milieu`, 'end');
  }

  // ------------------------------------------------ housekeeping

  sweep(now = Date.now()) {
    this.clock = now;
    for (const a of [...this.agents.values()]) {
      if (!this.agents.has(a.id)) continue;
      if (a.kind === 'session') {
        if (a.status !== 'done' && now - a.lastSeen > IDLE_TO_DONE_MS) {
          this.endSession(a, 'inactive');
          this.push(a);
        } else if (a.status === 'done' && now - a.lastSeen > DONE_TO_GONE_MS) {
          for (const c of this.childrenOf(a.id)) this.remove(c.id);
          this.remove(a.id);
        }
      } else if (!this.agents.has(a.sessionId)) {
        this.remove(a.id);
      } else if (a.status !== 'done' && now - a.lastSeen > IDLE_TO_DONE_MS) {
        this.finishChild(a);
        this.push(a);
      } else if (a.status === 'done' && now - (a.doneAt || a.lastSeen) > SUBAGENT_LINGER_MS) {
        this.remove(a.id);
      }
    }
  }

  remove(id) {
    if (this.transcripts) this.transcripts.untrack(id);
    if (this.agents.delete(id)) this.broadcast('remove', { id });
  }

  removeDemo() {
    for (const a of [...this.agents.values()]) if (a.demo) this.agents.delete(a.id);
    this.chronicle = this.chronicle.filter((e) => !e.demo);
    this.council = this.council.filter((e) => !e.demo);
    this.usage.demo = this.newUsage();
    for (const [k, v] of [...this.pendingUsage]) if (v.demo) this.pendingUsage.delete(k);
    this.broadcast('snapshot', this.snapshot());
  }

  // ------------------------------------------------ usage: transcripts

  /** Plugs the transcript reader in and starts tracking the agents already known (after load()). */
  attachTranscripts(reader) {
    this.transcripts = reader;
    for (const a of this.agents.values()) {
      if (a.demo || !a.transcriptPath) continue;
      if (reader.track(a.id, a.transcriptPath, a.kind)) reader.request(a.id, true);
    }
  }

  watchTranscripts(session, actor, ev) {
    const r = this.transcripts;
    if (!r || this.silent || ev.demo) return;
    const force = ev.hook === 'Stop' || ev.hook === 'PostToolUse' || ev.hook === 'SubagentStop';
    const want = [];
    if (session.transcriptPath && r.track(session.id, session.transcriptPath, 'session')) want.push(session.id);
    // Subagents: their own transcript when we know (or can derive) its path; otherwise ignored.
    const subs = actor !== session
      ? [actor]
      : ev.hook === 'SubagentStop'
        ? this.childrenOf(session.id).filter((c) => (ev.agent_id && c.agentId === ev.agent_id) || (ev.agent_transcript_path && c.transcriptPath === ev.agent_transcript_path))
        : [];
    for (const c of subs) {
      if (c.kind !== 'subagent') continue;
      if (!c.transcriptPath && c.agentId) c.transcriptPath = subagentTranscriptPath(session.transcriptPath, c.agentId);
      if (c.transcriptPath && r.track(c.id, c.transcriptPath, 'subagent')) want.push(c.id);
    }
    for (const id of want) r.request(id, force);
  }

  /** Periodic, non-forced read of the live agents (5 s throttle applies). */
  pollTranscripts() {
    if (!this.transcripts) return;
    for (const a of this.agents.values()) if (a.status !== 'done' && !a.demo) this.transcripts.request(a.id, false);
  }

  /** Adds token usage to an agent (transcript reader or demo). days: Map(day -> tokens). */
  addTokens(id, delta, model, days) {
    const a = this.agents.get(id);
    if (!a) return;
    a.tokens = U.addTokens(a.tokens, delta);
    if (model) a.tokens.model = model;
    else if (a.tokens.model === undefined) a.tokens.model = null;
    const src = a.demo ? this.usage.demo : this.usage.real;
    for (const [day, d] of days || []) src.daily.set(day, U.addTokens(src.daily.get(day), d));
    this.pruneDays(src);
    if (a.kind === 'subagent') {
      const s = this.agents.get(a.sessionId);
      if (s) {
        s.subTokens = U.addTokens(s.subTokens, delta);
        if (!(s.subagents || []).some((x) => x.id === a.id)) this.broadcast('agent', s);
      }
    }
    this.push(a);
    this.scheduleUsage();
  }

  pruneDays(src) {
    const keep = new Set([U.localDay(Date.now()), U.localDay(Date.now() - 86400000)]);
    for (const k of [...src.daily.keys()]) if (!keep.has(k)) src.daily.delete(k);
  }

  // ------------------------------------------------ usage: status line

  /** Ingests a raw status line payload. Never logs a chronicle entry except on threshold crossings. */
  ingestStatusline(raw, opts = {}) {
    const demo = !!(opts.demo || (raw && raw.demo === true));
    const sl = U.normalizeStatusline(raw, opts.ts || Date.now());
    const src = demo ? this.usage.demo : this.usage.real;
    if (sl.five) this.updateLimit(src, 'five', sl.five, sl.at, demo);
    if (sl.seven) this.updateLimit(src, 'seven', sl.seven, sl.at, demo);

    if (sl.session_id) {
      const per = {
        model: sl.model || null,
        contextPct: sl.context ? sl.context.pct : null,
        contextSize: sl.context ? sl.context.size : null,
        costUsd: sl.cost ? sl.cost.usd : null,
        durationMs: sl.cost ? sl.cost.durationMs : null,
        linesAdded: sl.cost ? sl.cost.linesAdded : null,
        linesRemoved: sl.cost ? sl.cost.linesRemoved : null,
        at: sl.at,
      };
      if (per.costUsd != null) src.costs.set(sl.session_id, { usd: per.costUsd, day: U.localDay(sl.at) });
      if (src.costs.size > 500) src.costs.delete(src.costs.keys().next().value);
      const a = this.agents.get(sl.session_id);
      if (a && a.kind === 'session' && !!a.demo === demo) {
        if (sl.transcript_path && !a.transcriptPath) a.transcriptPath = sl.transcript_path;
        this.applySessionUsage(a, per, true);
        if (this.transcripts && !demo && a.transcriptPath) {
          if (this.transcripts.track(a.id, a.transcriptPath, 'session')) this.transcripts.request(a.id, false);
        }
      } else if (!a) {
        // Unknown session: kept aside (no ghost company) until its first hook event.
        this.pendingUsage.delete(sl.session_id);
        this.pendingUsage.set(sl.session_id, { per, at: sl.at, demo, transcript_path: sl.transcript_path });
        if (this.pendingUsage.size > MAX_PENDING_USAGE) this.pendingUsage.delete(this.pendingUsage.keys().next().value);
      }
    }
    this.scheduleUsage();
    return sl;
  }

  applySessionUsage(a, per, announce) {
    const prev = a.usage || {};
    const next = { ...prev };
    for (const [k, v] of Object.entries(per)) if (v != null) next[k] = v;
    const sig = (u) => JSON.stringify({ ...u, at: 0 });
    const changed = sig(prev) !== sig(next);
    a.usage = next;
    const pct = next.contextPct;
    if (pct != null) {
      if (pct >= U.CONTEXT_WARN && !a.ctxWarned) {
        a.ctxWarned = true;
        if (announce) this.log('chronicle', a, '🎒', `Le sac de ${this.label(a)} est plein : ${Math.round(pct)} % du contexte utilisé`, 'usage');
      } else if (pct < U.CONTEXT_REARM) {
        a.ctxWarned = false;
      }
    }
    if (changed && announce) this.push(a);
  }

  updateLimit(src, key, reading, at, demo) {
    src[key] = U.mergeLimit(src[key], reading, at);
    const levels = key === 'five' ? U.FIVE_LEVELS : U.SEVEN_LEVELS;
    const r = U.stepWatch(src.watch[key], src[key], levels);
    const extra = { demo };
    const pct = Math.round(src[key].pct || 0);
    if (r.reset) {
      this.log('chronicle', null, '🌅', `Les réserves sont reconstituées (limite ${key === 'five' ? '5 h' : '7 jours'})`, 'usage', { ...extra, limit: key, reset: true });
    }
    if (r.level != null) {
      let icon = '⚠️';
      let text;
      if (key === 'five') {
        if (r.level >= 100) {
          icon = '🏕';
          text = `Plus de lembas ! Limite 5 h atteinte (${pct} %) : la compagnie campe jusqu'au reset`;
        } else if (r.level >= 80) {
          text = `Les lembas s'épuisent : ${pct} % de la limite 5 h`;
        } else {
          icon = '🍞';
          text = `La moitié des lembas est entamée : ${pct} % de la limite 5 h`;
        }
      } else {
        text = `Les greniers se vident : ${pct} % de la limite 7 jours`;
      }
      this.log('chronicle', null, icon, text, 'usage', { ...extra, limit: key, level: r.level });
    }
    if (r.changed && !demo) this.saveUsageState();
  }

  usageView(kind) {
    const src = this.usage[kind];
    const now = Date.now();
    const day = U.localDay(now);
    const tok = src.daily.get(day) || null;
    let cost = null;
    let costSessions = 0;
    for (const c of src.costs.values()) {
      if (c.day !== day) continue;
      cost = (cost || 0) + c.usd;
      costSessions++;
    }
    if (!src.five && !src.seven && !tok && cost == null) return null;
    return {
      five: src.five,
      seven: src.seven,
      today: { day, tokens: tok, costUsd: cost, costSessions },
      demo: kind === 'demo',
    };
  }

  usageSnapshot() {
    return { real: this.usageView('real'), demo: this.usageView('demo') };
  }

  /** Coalesced 'usage' broadcast (status lines can arrive several times per second). */
  scheduleUsage() {
    if (this.silent || this.usageTimer) return;
    this.usageTimer = setTimeout(() => {
      this.usageTimer = null;
      const u = this.usageSnapshot();
      const sig = JSON.stringify(u, (k, v) => (k === 'at' ? undefined : v));
      if (sig === this.lastUsageSig) return;
      this.lastUsageSig = sig;
      this.broadcast('usage', u);
    }, 250);
    if (this.usageTimer.unref) this.usageTimer.unref();
  }

  // ------------------------------------------------ output

  push(a) {
    if (a.kind === 'subagent') {
      const s = this.agents.get(a.sessionId);
      const entry = s && s.subagents && s.subagents.find((x) => x.id === a.id);
      if (entry) {
        entry.status = a.status;
        entry.result = a.result ? clip(a.result, 200) : '';
        entry.endedAt = a.doneAt;
        entry.lastAction = a.lastAction;
        if (s !== a) this.broadcast('agent', s);
      }
    }
    this.broadcast('agent', a);
  }

  log(channel, agent, icon, text, kind, extra) {
    const entry = {
      id: ++this.logSeq,
      t: this.clock,
      channel,
      agentId: agent ? agent.id : null,
      sessionId: agent ? agent.sessionId : null,
      project: agent ? agent.project : '',
      icon,
      text: clip(text, 220),
      kind,
      demo: agent ? !!agent.demo : false,
      ...(extra || {}),
    };
    const list = channel === 'council' ? this.council : this.chronicle;
    const max = channel === 'council' ? MAX_COUNCIL : MAX_CHRONICLE;
    list.push(entry);
    if (list.length > max) list.splice(0, list.length - max);
    this.broadcast('log', entry);
  }

  fx(data) {
    this.broadcast('fx', data);
  }

  broadcast(type, data) {
    if (!this.silent) this.emit('broadcast', type, data);
  }

  snapshot() {
    return {
      agents: [...this.agents.values()],
      chronicle: this.chronicle.slice(-200),
      council: this.council.slice(-100),
      territories: TERRITORIES,
      usage: this.usageSnapshot(),
      demo: this.demoActive,
      serverTime: Date.now(),
    };
  }
}

module.exports = {
  Store,
  TERRITORIES,
  sanitizeEvent,
  sanitizeOrigin,
  parseOriginHeader,
  describeTool,
  roleFor,
  clip,
  IDLE_TO_DONE_MS,
  DONE_TO_GONE_MS,
};
