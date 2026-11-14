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
// Same dictionaries as the page: the server sends { key, params } and keeps a French `text`
// (backward compatibility, logs, tests). The page renders the key in the chosen language.
const I18N = require('../public/js/i18n');
I18N.register('fr', require('../public/i18n/fr'));

/** A translatable message. */
function M(key, params) {
  return params ? { key, params } : { key };
}
/** French rendering of a message (or a raw string). */
function fr(msg) {
  return typeof msg === 'string' ? msg : I18N.tl('fr', msg.key, msg.params);
}

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

const ROLES = ['hobbit', 'dwarf', 'wizard', 'scout', 'painter', 'troll'];
const roleKey = (role) => (ROLES.includes(role) ? role : 'dwarf');

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
    return new URL(str(url)).host || clip(url, 30) || M('word.farLand');
  } catch {
    return clip(url, 30) || M('word.farLand');
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

/** Claude Code notification (English) -> message; null for an unknown text (kept as is). */
function notificationMessage(m) {
  const s = oneLine(m);
  let r;
  if ((r = /needs your permission to use (.+)$/i.exec(s))) return M('wait.permission', { tool: clip(r[1], 80) });
  if (/waiting for your input/i.test(s)) return M('wait.input');
  if (/needs your attention/i.test(s)) return M('wait.attention');
  return s ? null : M('wait.input');
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
  // Demo only: dictionary keys of the simulated texts (prompt, question…), so they get translated too.
  if (ev.demo && raw.i18n && typeof raw.i18n === 'object' && !Array.isArray(raw.i18n)) {
    const i = {};
    for (const k of DEMO_I18N_FIELDS) {
      const v = raw.i18n[k];
      if (typeof v === 'string' && /^demo\.[A-Za-z0-9._-]{1,80}$/.test(v)) i[k] = v;
    }
    if (Object.keys(i).length) ev.i18n = i;
  }
  return ev;
}
const DEMO_I18N_FIELDS = ['prompt', 'question', 'description', 'taskPrompt', 'result', 'message'];

/** Message for a text that has a demo dictionary key, the raw text otherwise. */
function demoText(ev, field, text) {
  const k = ev && ev.i18n && ev.i18n[field];
  return k ? M(k) : text;
}

// ---------------------------------------------------------------- tool description

function mk(status, activity, short, icon, chron) {
  return { status, activity, short, icon, chron };
}

/**
 * Maps a tool call to a status + short action (speech bubble) + themed chronicle line.
 * `short` and `chron` are messages ({ key, params }), rendered by the page in its language.
 */
function describeTool(tool, input, actor, project, ev) {
  const i = input && typeof input === 'object' ? input : {};
  const tag = actor.kind === 'subagent' ? ` (${actor.subagentType})` : '';
  const S = (kind) => M('actor.' + kind, { project, tag });
  const file = baseName(i.file_path || i.notebook_path) || M('word.scroll');
  const n = actor.counters[tool] || 1;
  let seek = false; // reading / searching (a painter "looks for inspiration")
  let r;
  switch (tool) {
    case 'Edit':
    case 'MultiEdit':
      r = mk('coding', null, M('act.edit', { file }), '⚒', M('log.edit', { actor: S('coding'), file, v: n }));
      break;
    case 'Write':
      r = mk('coding', null, M('act.write', { file }), '⚒', M('log.write', { actor: S('coding'), file }));
      break;
    case 'NotebookEdit':
      r = mk('coding', null, M('act.edit', { file }), '⚒', M('log.notebook', { actor: S('coding'), file }));
      break;
    case 'Read':
      seek = true;
      r = n % 5 === 0
        ? mk('thinking', 'think', M('act.read', { file }), '🧙', M('log.readMany', { actor: S('think'), count: n }))
        : mk('thinking', 'think', M('act.read', { file }), '📜', M('log.read', { actor: S('think'), file }));
      break;
    case 'Grep': {
      seek = true;
      const pat = clip(i.pattern, 30) || '?';
      const dir = shortDir(i.path || i.glob);
      r = dir
        ? mk('thinking', 'research', M('act.grepIn', { pat: clip(pat, 18), dir }), '🔍', M('log.grepIn', { actor: S('research'), pat, dir }))
        : mk('thinking', 'research', M('act.grep', { pat: clip(pat, 18) }), '🔍', M('log.grep', { actor: S('research'), pat }));
      break;
    }
    case 'Glob':
      seek = true;
      r = mk('thinking', 'research', M('act.explore', { pat: clip(i.pattern, 24) }), '🗺', M('log.glob', { actor: S('research'), pat: clip(i.pattern, 40) }));
      break;
    case 'LS': {
      seek = true;
      const dir = shortDir(i.path) || M('word.surroundings');
      r = mk('thinking', 'research', M('act.explore', { pat: dir }), '🗺', M('log.ls', { actor: S('research'), dir }));
      break;
    }
    case 'WebSearch':
      seek = true;
      r = mk('thinking', 'research', M('act.websearch', { q: clip(i.query, 24) }), '🧝', M('log.websearch', { actor: S('research'), q: clip(i.query, 60) }));
      break;
    case 'WebFetch': {
      const host = hostOf(i.url);
      r = mk('thinking', 'research', M('act.webfetch', { host: typeof host === 'string' ? clip(host, 22) : host }), '🕊', M('log.webfetch', { actor: S('research'), host }));
      break;
    }
    case 'Bash': {
      const full = oneLine(i.command);
      const cmd = clip(full, 60) || '…';
      const short = M('act.bash', { cmd: clip(full, 24) });
      const run = (key, icon) => mk('running', null, short, icon, M(key, { actor: S('running'), cmd }));
      if (/\b(test|tests|jest|vitest|pytest|mocha|spec|playwright|cypress)\b/i.test(full)) r = run('log.bashTest', '🧌');
      else if (/\bgit\b/.test(full)) r = run('log.bashGit', '📯');
      else if (/\b(npm|pnpm|yarn|bun|pip|cargo) (i|install|add)\b/.test(full)) r = run('log.bashInstall', '📦');
      else if (/build|tsc|lint|make|webpack|vite|cargo/.test(full)) r = run('log.bashBuild', '🪨');
      else r = run('log.bash', '🪨');
      break;
    }
    case 'BashOutput':
    case 'KillShell':
    case 'KillBash':
      r = mk('running', null, M('act.watch'), '🪨', M('log.watch', { actor: S('running') }));
      break;
    case 'TodoWrite': {
      const count = i.todos_count;
      r = mk('thinking', 'think', M('act.todo'), '🧙', count ? M('log.todoN', { actor: S('think'), count }) : M('log.todo', { actor: S('think') }));
      break;
    }
    case 'AskUserQuestion': {
      const raw = i.questions && i.questions[0] && i.questions[0].question;
      const q = demoText(ev, 'question', raw ? clip(raw, 90) : M('word.question'));
      r = mk('waiting', null, M('act.ask'), '🔥', M('log.ask', { who: project + tag, q }));
      r.waitMessage = demoText(ev, 'question', raw ? clip(raw, 200) : M('word.question'));
      break;
    }
    case 'ExitPlanMode':
      r = mk('waiting', null, M('act.plan'), '🔥', M('log.plan', { who: project + tag }));
      r.waitMessage = M('wait.plan');
      break;
    case 'Skill': {
      const skill = i.skill || i.name ? clip(i.skill || i.name, 40) : M('word.unknown');
      r = mk('thinking', 'think', M('act.skill', { skill: typeof skill === 'string' ? clip(skill, 20) : skill }), '✨', M('log.skill', { actor: S('think'), skill }));
      break;
    }
    default:
      if (tool.startsWith('mcp__')) {
        const parts = tool.split('__');
        const server = parts[1] || '?';
        const name = parts.slice(2).join('__');
        r = mk('thinking', 'think', M('act.mcp', { server: clip(server, 16) }), '🔮',
          name ? M('log.mcpTool', { actor: S('think'), server, name }) : M('log.mcp', { actor: S('think'), server }));
      } else {
        r = mk('thinking', 'think', M('act.tool', { tool: clip(tool, 20) }), '✨', M('log.tool', { actor: S('think'), tool }));
      }
  }
  // Design work: tool name or painter subagent.
  if (r.status !== 'waiting' && (isDesignName(tool) || (actor.role === 'painter' && r.status !== 'running'))) {
    const subject = i.file_path || i.notebook_path ? file : i.query || i.pattern || i.description ? clip(i.query || i.pattern || i.description, 40) : M('word.vision');
    r.status = 'designing';
    r.activity = null;
    r.icon = '🎨';
    r.chron = M(seek ? 'log.designSeek' : 'log.designPaint', { actor: S('designing'), subject });
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
        this.addAction(session, session, M('act.arrive'), 'SessionStart', 'idle');
        const t = TERR_BY_KEY[session.territory];
        this.log('chronicle', session, '🌄', t
          ? M('log.start', { where: M('terr.' + t.key + '.where'), project: session.project })
          : M('log.startNowhere', { project: session.project }), 'start');
        break;
      }
      case 'UserPromptSubmit': {
        this.clearWaiting(session, true);
        session.lastPrompt = clip(oneLine(ev.prompt), 240);
        session.lastPromptI = ev.i18n && ev.i18n.prompt ? M(ev.i18n.prompt) : null;
        this.setStatus(session, 'thinking', 'think');
        this.addAction(session, session, M('act.quest'), 'Prompt', 'thinking');
        this.log('chronicle', session, '🧭', M('log.prompt', { project: session.project, prompt: demoText(ev, 'prompt', clip(oneLine(ev.prompt), 90) || '…') }), 'prompt');
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
        this.addAction(session, session, M('act.rest'), 'Stop', 'idle');
        this.log('chronicle', session, '🏕', M('log.rest', { project: session.project }), 'idle');
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
      lastPromptI: null, // demo: dictionary key of the prompt
      lastAction: '',
      lastActionI: null, // { key, params } of lastAction (rendered by the page)
      lastActionAt: 0,
      description: '',
      prompt: '',
      result: '',
      descriptionI: null, // demo: dictionary keys of the simulated mission texts
      promptI: null,
      resultI: null,
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
    // Fixed order, starting from the Shire (hobbits = sessions): the first free land wins.
    const n = TERRITORIES.length;
    let chosen = TERRITORIES[hashStr(s.id) % n].key; // all taken: share with someone
    for (const { key } of TERRITORIES) {
      if (!occupied.has(key)) {
        chosen = key;
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
    c.descriptionI = o.descriptionI || null;
    c.promptI = o.promptI || null;
    c.toolUseId = o.toolUseId || null;
    if (role === 'painter') this.setStatus(c, 'designing');
    else if (role === 'scout') this.setStatus(c, 'thinking', 'research');
    else if (role === 'troll') this.setStatus(c, 'running');
    else if (role === 'dwarf') this.setStatus(c, 'coding');
    else this.setStatus(c, 'thinking', 'think');
    this.setLastAction(c, M('act.mission'), o.ts);
    this.agents.set(id, c);
    session.subagentTotal = (session.subagentTotal || 0) + 1;
    session.subagents.unshift({
      id,
      type: c.subagentType,
      role,
      description: c.description,
      descriptionI: c.descriptionI,
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
      this.log('chronicle', a, '✅', M('log.resume', { project: a.project }), 'resume');
    }
  }

  /** lastAction keeps a French text (native app, older pages); lastActionI is the message. */
  setLastAction(a, msg, at) {
    a.lastAction = clip(fr(msg), 120);
    a.lastActionI = typeof msg === 'string' ? null : msg;
    a.lastActionAt = at;
  }

  addAction(session, actor, msg, tool, status) {
    const entry = { t: this.clock, text: clip(fr(msg), 120), tool, status, who: actor.kind === 'subagent' ? actor.subagentType : null };
    if (typeof msg !== 'string') {
      entry.key = msg.key;
      if (msg.params) entry.params = msg.params;
    }
    actor.actions.unshift(entry);
    if (actor.actions.length > MAX_ACTIONS) actor.actions.length = MAX_ACTIONS;
    this.setLastAction(actor, msg, this.clock);
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

    const d = describeTool(tool, input, actor, session.project, ev);
    if (d.status === 'waiting') actor.waiting = this.waitingOf(d.waitMessage || d.short, tool);
    this.setStatus(actor, d.status, d.activity);
    this.addAction(session, actor, d.short, tool, d.status);
    this.log('chronicle', actor, d.icon, d.chron, d.status === 'waiting' ? 'alert' : 'tool', { tool: clip(tool, 60) });
  }

  onSpawn(session, actor, ev, input, changed) {
    const type = clip(input.subagent_type || 'general-purpose', 60);
    const rawDesc = oneLine(input.description);
    const descI = ev.i18n && ev.i18n.description ? M(ev.i18n.description) : !rawDesc ? M('word.secret') : null;
    const desc = rawDesc || fr(M('word.secret'));
    const promptI = ev.i18n && ev.i18n.taskPrompt ? M(ev.i18n.taskPrompt) : null;
    const child = this.spawnChild(session, actor, {
      type,
      description: desc,
      descriptionI: descI,
      prompt: input.prompt,
      promptI,
      toolUseId: ev.tool_use_id,
      ts: ev.ts,
      demo: ev.demo,
    });
    changed.add(child);
    this.setStatus(actor, 'talking');
    this.addAction(session, actor, M('act.delegate', { type, desc: descI || clip(desc, 40) }), ev.tool_name, 'talking');
    this.log('council', actor, '📜', M('council.spawn', { desc: descI || clip(desc, 140) }), 'spawn', {
      from: this.label(actor),
      to: this.label(child),
      body: clip(oneLine(input.prompt), 400),
      ...(promptI ? { bodyI: promptI } : {}),
      childId: child.id,
    });
    this.log('chronicle', actor, '🚶', M('log.spawn', { project: session.project, role: M('role.a.' + roleKey(child.role)), type, desc: descI || clip(desc, 70) }), 'spawn');
  }

  onSendMessage(session, actor, ev, input, changed) {
    const to = oneLine(input.to || input.recipient || input.target || input.name);
    const target = this.findAgentByName(to, actor);
    const toMsg = target ? this.label(target) : to || M('word.somewhere');
    const toLabel = fr(toMsg);
    const bodyI = ev.i18n && ev.i18n.message ? M(ev.i18n.message) : null;
    this.setStatus(actor, 'talking');
    this.addAction(session, actor, M('act.message', { to: typeof toMsg === 'string' ? clip(toMsg, 24) : toMsg }), 'SendMessage', 'talking');
    this.log('council', actor, '🦅', M('council.message', { to: toMsg }), 'message', {
      from: this.label(actor),
      to: toLabel,
      ...(typeof toMsg === 'string' ? {} : { toI: toMsg }),
      body: clip(oneLine(input.message || input.content || input.summary), 300),
      ...(bodyI ? { bodyI } : {}),
    });
    this.log('chronicle', actor, '🦅', M('log.message', { from: this.label(actor), to: toMsg }), 'message');
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
    const resultI = ev.i18n && ev.i18n.result ? M(ev.i18n.result) : null;
    if (child) {
      if (result) child.result = clip(result, 600);
      if (resultI) child.resultI = resultI;
      if (child.status !== 'done') this.finishChild(child);
      changed.add(child);
      if (!child.returnLogged) {
        child.returnLogged = true;
        const bodyI = resultI || (result ? null : M('council.done'));
        this.log('council', child, '🏁', M('council.return', { desc: child.descriptionI || clip(child.description, 100) }), 'return', {
          from: this.label(child),
          to: this.label(actor),
          body: clip(result, 400) || fr(M('council.done')),
          ...(bodyI ? { bodyI } : {}),
        });
      }
      this.setStatus(actor, 'thinking', 'think');
      this.addAction(session, actor, M('act.readReport', { type: child.subagentType }), tool, 'thinking');
    }
  }

  finishChild(c) {
    this.clearWaiting(c);
    c.status = 'done';
    c.activity = null;
    c.doneAt = this.clock;
    this.setLastAction(c, M('act.back'), this.clock);
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
    this.log('chronicle', child, '🏁', M('log.return', { role: M('role.the.' + roleKey(child.role)), project: session.project, type: child.subagentType }), 'return');
  }

  /** actor.waiting: French `message` (native app, older pages) + the message `i` when translatable. */
  waitingOf(msg, kind) {
    const w = { message: clip(fr(msg), 300), since: this.clock, kind };
    if (typeof msg !== 'string') w.i = msg;
    return w;
  }

  onNotification(session, actor, ev) {
    const m = notificationMessage(ev.message);
    const msg = m || clip(oneLine(ev.message), 300);
    actor.waiting = this.waitingOf(msg, ev.notification_type || 'notification');
    this.setStatus(actor, 'waiting');
    this.addAction(session, actor, msg, 'Notification', 'waiting');
    this.log('chronicle', actor, '🔥', M('log.alert', { who: this.label(actor), msg: m || clip(msg, 100) }), 'alert');
  }

  endSession(s, reason) {
    this.clearWaiting(s);
    s.status = 'done';
    s.activity = null;
    s.doneAt = this.clock;
    this.setLastAction(s, M(reason === 'inactive' ? 'act.asleep' : 'act.left'), this.clock);
    for (const c of this.childrenOf(s.id)) {
      if (c.status !== 'done') {
        this.finishChild(c);
        this.push(c);
      }
    }
    this.log('chronicle', s, '🌅', M(reason === 'inactive' ? 'log.asleep' : 'log.end', { project: s.project }), 'end');
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
        if (announce) this.log('chronicle', a, '🎒', M('log.bag', { who: this.label(a), pct: Math.round(pct) }), 'usage');
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
      this.log('chronicle', null, '🌅', M(key === 'five' ? 'log.reset5' : 'log.reset7'), 'usage', { ...extra, limit: key, reset: true });
    }
    if (r.level != null) {
      let icon = '⚠️';
      let msg;
      if (key === 'five') {
        if (r.level >= 100) {
          icon = '🏕';
          msg = M('log.five100', { pct });
        } else if (r.level >= 80) {
          msg = M('log.five80', { pct });
        } else {
          icon = '🍞';
          msg = M('log.five50', { pct });
        }
      } else {
        msg = M('log.seven', { pct });
      }
      this.log('chronicle', null, icon, msg, 'usage', { ...extra, limit: key, level: r.level });
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
        entry.lastActionI = a.lastActionI;
        entry.resultI = a.resultI || null;
        if (s !== a) this.broadcast('agent', s);
      }
    }
    this.broadcast('agent', a);
  }

  /**
   * Chronicle / council entry: { kind, key, params } rendered by the page in its language, plus a
   * French `text` (backward compatibility, tests). msg: { key, params } (or a raw string).
   */
  log(channel, agent, icon, msg, kind, extra) {
    const entry = {
      id: ++this.logSeq,
      t: this.clock,
      channel,
      agentId: agent ? agent.id : null,
      sessionId: agent ? agent.sessionId : null,
      project: agent ? agent.project : '',
      icon,
      text: clip(fr(msg), 220),
      ...(typeof msg === 'string' ? {} : { key: msg.key, params: msg.params || {} }),
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
