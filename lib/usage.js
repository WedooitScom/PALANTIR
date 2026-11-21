'use strict';
/**
 * Claude usage helpers (numbers only, never message content):
 * - normalizeStatusline(): turns the JSON Claude Code sends to its status line into a small, safe object
 * - stepWatch(): threshold / reset detection for the 5 h and 7 day limits (one message per level and window)
 * - token arithmetic and the local day key used for "today" totals
 */

const FIVE_LEVELS = [50, 80, 90, 95, 100];
const SEVEN_LEVELS = [80, 90];
// Two payloads whose resets_at differ by less than this belong to the same window (clock jitter).
const WINDOW_SLACK_S = 120;
const CONTEXT_WARN = 85;
const CONTEXT_REARM = 70;

function obj(v) {
  return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
}

function num(v, min, max) {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
  if (typeof n !== 'number' || !Number.isFinite(n)) return null;
  return Math.min(max, Math.max(min, n));
}

function sstr(v, n) {
  if (typeof v !== 'string' || !v) return null;
  return v.length > n ? v.slice(0, n) : v;
}

/** Epoch seconds from a number (s or ms) or an ISO string. */
function epochSeconds(v) {
  if (typeof v === 'string' && v.trim() && !/^\d+(\.\d+)?$/.test(v.trim())) {
    const t = Date.parse(v);
    return Number.isFinite(t) ? Math.round(t / 1000) : null;
  }
  const n = num(v, 0, 1e14);
  if (n == null || n === 0) return null;
  return n > 1e11 ? Math.round(n / 1000) : Math.round(n);
}

function limitWindow(w) {
  w = obj(w);
  const pct = num(w.used_percentage, 0, 1000);
  const resetsAt = epochSeconds(w.resets_at);
  if (pct == null && resetsAt == null) return null;
  return { pct, resetsAt };
}

/** Normalizes a raw status line payload. Every field is optional; never throws. */
function normalizeStatusline(raw, now = Date.now()) {
  raw = obj(raw);
  const model = obj(raw.model);
  const cost = obj(raw.cost);
  const cw = obj(raw.context_window);
  const rl = obj(raw.rate_limits);
  const ws = obj(raw.workspace);

  const out = { at: now };
  const sid = sstr(raw.session_id, 120);
  if (sid) out.session_id = sid;
  const tp = sstr(raw.transcript_path, 400);
  if (tp) out.transcript_path = tp;
  const cwd = sstr(raw.cwd, 400) || sstr(ws.current_dir, 400);
  if (cwd) out.cwd = cwd;

  const modelId = sstr(model.id, 80);
  const modelName = sstr(model.display_name, 60);
  if (modelId || modelName) out.model = { id: modelId, name: modelName };

  let pct = num(cw.used_percentage, 0, 100);
  const size = num(cw.context_window_size, 0, 1e8);
  if (pct == null && size) {
    // Fallback: current_usage (input side of the last request) over the window size.
    const cu = obj(cw.current_usage);
    const used = (num(cu.input_tokens, 0, 1e9) || 0) + (num(cu.cache_creation_input_tokens, 0, 1e9) || 0)
      + (num(cu.cache_read_input_tokens, 0, 1e9) || 0);
    if (used > 0) pct = Math.min(100, (used / size) * 100);
  }
  const context = {
    pct,
    size,
    totalInput: num(cw.total_input_tokens, 0, 1e12),
    totalOutput: num(cw.total_output_tokens, 0, 1e12),
  };
  if (Object.values(context).some((v) => v != null)) out.context = context;

  const c = {
    usd: num(cost.total_cost_usd, 0, 1e6),
    durationMs: num(cost.total_duration_ms, 0, 1e12),
    linesAdded: num(cost.total_lines_added, 0, 1e9),
    linesRemoved: num(cost.total_lines_removed, 0, 1e9),
  };
  if (Object.values(c).some((v) => v != null)) out.cost = c;

  const five = limitWindow(rl.five_hour);
  if (five) out.five = five;
  const seven = limitWindow(rl.seven_day);
  if (seven) out.seven = seven;
  return out;
}

/**
 * Merges a new limit reading into the current one.
 * Same window: the used % can only grow, so keep the max (an idle session may re-render an older value).
 * Later window: take it. Earlier window: stale payload, ignore.
 */
function mergeLimit(prev, next, at) {
  if (!prev) return { pct: next.pct, resetsAt: next.resetsAt, at };
  const pr = prev.resetsAt, nr = next.resetsAt;
  if (pr != null && nr != null) {
    if (nr < pr - WINDOW_SLACK_S) return prev; // stale
    if (nr > pr + WINDOW_SLACK_S) return { pct: next.pct, resetsAt: nr, at }; // new window
    const pct = next.pct == null ? prev.pct : prev.pct == null ? next.pct : Math.max(prev.pct, next.pct);
    return { pct, resetsAt: nr, at };
  }
  return { pct: next.pct != null ? next.pct : prev.pct, resetsAt: nr != null ? nr : pr, at };
}

/**
 * Threshold / reset detection. `st` = { window, done: number[], lastPct } (mutated).
 * Returns { level: highest newly crossed level or null, reset: bool, changed: bool }.
 * A jump over several levels announces only the highest one; each level once per window.
 */
function stepWatch(st, cur, levels) {
  const out = { level: null, reset: false, changed: false };
  if (!cur) return out;
  const win = cur.resetsAt != null ? cur.resetsAt : null;
  if (win != null) {
    if (st.window == null) {
      st.window = win;
      out.changed = true;
    } else if (win > st.window + WINDOW_SLACK_S) {
      out.reset = st.lastPct != null;
      st.window = win;
      st.done = [];
      out.changed = true;
    }
  } else if (cur.pct != null && st.lastPct != null && cur.pct < st.lastPct - 30) {
    // No reset timestamp: a big drop means a new window.
    out.reset = true;
    st.done = [];
    out.changed = true;
  }
  if (cur.pct != null) {
    for (const L of levels) {
      if (cur.pct >= L && !st.done.includes(L)) {
        st.done.push(L);
        out.level = L;
        out.changed = true;
      }
    }
    if (st.lastPct !== cur.pct) out.changed = true;
    st.lastPct = cur.pct;
  }
  return out;
}

function newWatch() {
  return { window: null, done: [], lastPct: null };
}

const TOKEN_KEYS = ['input', 'output', 'cacheCreation', 'cacheRead'];

function emptyTokens() {
  return { input: 0, output: 0, cacheCreation: 0, cacheRead: 0, total: 0 };
}

function addTokens(base, d) {
  const t = base ? { ...base } : emptyTokens();
  for (const k of TOKEN_KEYS) t[k] = (t[k] || 0) + (Number(d && d[k]) || 0);
  t.total = TOKEN_KEYS.reduce((s, k) => s + t[k], 0);
  return t;
}

/** Local calendar day "YYYY-MM-DD" (today = since local midnight). */
function localDay(ts = Date.now()) {
  const d = new Date(ts);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

module.exports = {
  FIVE_LEVELS,
  SEVEN_LEVELS,
  CONTEXT_WARN,
  CONTEXT_REARM,
  WINDOW_SLACK_S,
  normalizeStatusline,
  mergeLimit,
  stepWatch,
  newWatch,
  emptyTokens,
  addTokens,
  localDay,
  TOKEN_KEYS,
};
