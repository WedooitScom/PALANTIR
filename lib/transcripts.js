'use strict';
/**
 * Incremental reader of Claude Code transcripts (JSONL) — token usage only.
 *
 * - Only files under ~/.claude/projects (or $CLAUDE_CONFIG_DIR/projects) ending in .jsonl are read,
 *   checked again after resolving symlinks.
 * - Per tracked agent: byte offset already read, so each pass only reads what was appended.
 *   Reads are asynchronous, in 1 MB chunks: never a synchronous read of a big file.
 * - At most one read every 5 s per agent, or 1 s when forced (Stop / PostToolUse / SubagentStop).
 * - Sums message.usage of assistant entries, deduplicated by message.id (or requestId): one response
 *   is often split over several lines carrying the same usage.
 * - Nothing but numbers (and the model name) leaves this module.
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { StringDecoder } = require('node:string_decoder');
const { localDay, TOKEN_KEYS } = require('./usage');

const fsp = fs.promises;
const MIN_INTERVAL_MS = 5000;
const FORCE_INTERVAL_MS = 1000;
const CHUNK = 1 << 20;
const MAX_PARTIAL = 32 * 1024 * 1024;

function defaultRoot() {
  return path.join(process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'), 'projects');
}

function pos(v) {
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0;
}

/** Extracts the usage of one transcript line, or null. Exported for tests. */
function usageFromLine(line, opts = {}) {
  if (!line || line.indexOf('"usage"') === -1) return null;
  let o;
  try {
    o = JSON.parse(line);
  } catch {
    return null;
  }
  if (!o || o.type !== 'assistant' || !o.message || typeof o.message !== 'object') return null;
  // In a session file, sidechain entries belong to a subagent (old format): counted only if the
  // subagent has its own transcript, so ignored here.
  if (opts.skipSidechain && o.isSidechain === true) return null;
  const u = o.message.usage;
  if (!u || typeof u !== 'object') return null;
  const id = (typeof o.message.id === 'string' && o.message.id) || (typeof o.requestId === 'string' && o.requestId) || null;
  const m = o.message.model;
  const model = typeof m === 'string' && m && m !== '<synthetic>' ? m.slice(0, 80) : null;
  const ts = Date.parse(o.timestamp);
  return {
    id,
    model,
    ts: Number.isFinite(ts) ? ts : Date.now(),
    input: pos(u.input_tokens),
    output: pos(u.output_tokens),
    cacheCreation: pos(u.cache_creation_input_tokens),
    cacheRead: pos(u.cache_read_input_tokens),
  };
}

/** Path of a subagent transcript next to its session's: <session>/subagents/agent-<id>.jsonl */
function subagentTranscriptPath(sessionTranscript, agentId) {
  if (typeof sessionTranscript !== 'string' || !sessionTranscript.endsWith('.jsonl')) return null;
  const id = String(agentId || '');
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(id)) return null;
  return path.join(path.dirname(sessionTranscript), path.basename(sessionTranscript, '.jsonl'), 'subagents', `agent-${id}.jsonl`);
}

class TranscriptReader {
  /**
   * @param {object} o
   * @param {string} [o.root] directory transcripts must live in (default ~/.claude/projects)
   * @param {(key, delta, model, days: Map<string, object>) => void} o.onUsage called after each pass that found usage
   */
  constructor(o = {}) {
    this.root = path.resolve(o.root || defaultRoot());
    this.onUsage = o.onUsage || null;
    this.now = o.now || Date.now;
    this.tracks = new Map();
    this.rootRealPromise = null;
  }

  /** Lexical check (the real path is checked again before reading). */
  allowed(file) {
    if (typeof file !== 'string' || !file.endsWith('.jsonl') || !path.isAbsolute(file)) return null;
    const r = path.resolve(file);
    return r.startsWith(this.root + path.sep) ? r : null;
  }

  rootReal() {
    if (!this.rootRealPromise) this.rootRealPromise = fsp.realpath(this.root).catch(() => this.root);
    return this.rootRealPromise;
  }

  /** Starts (or retargets) tracking `key` (an agent id). kind 'session' skips sidechain entries. */
  track(key, file, kind = 'session') {
    const resolved = this.allowed(file);
    if (!resolved) return false;
    let t = this.tracks.get(key);
    if (!t) {
      // `seen` is per agent, not per file: a resumed session copying old messages is not counted twice.
      t = { key, kind, seen: new Set(), file: null, offset: 0, partial: '', decoder: null, lastRead: 0, reading: false, again: false, timer: null };
      this.tracks.set(key, t);
    }
    if (t.file !== resolved) {
      t.file = resolved;
      t.offset = 0;
      t.partial = '';
      t.decoder = new StringDecoder('utf8');
      t.lastRead = 0;
    }
    return true;
  }

  untrack(key) {
    const t = this.tracks.get(key);
    if (!t) return;
    if (t.timer) clearTimeout(t.timer);
    this.tracks.delete(key);
  }

  has(key) {
    return this.tracks.has(key);
  }

  /** Asks for a read; honoured at most every 5 s (1 s when forced, with a trailing read). */
  request(key, force = false) {
    const t = this.tracks.get(key);
    if (!t) return null;
    const wait = (force ? FORCE_INTERVAL_MS : MIN_INTERVAL_MS) - (this.now() - t.lastRead);
    if (wait <= 0) return this.read(t);
    if (force && !t.timer) {
      t.timer = setTimeout(() => {
        t.timer = null;
        this.read(t);
      }, wait);
      if (t.timer.unref) t.timer.unref();
    }
    return null;
  }

  /** Reads what was appended since the last pass. Returns the in-flight promise. */
  read(t) {
    if (t.reading) {
      t.again = true;
      return t.current;
    }
    t.reading = true;
    t.lastRead = this.now();
    t.current = (async () => {
      try {
        await this.readNew(t);
      } catch {
        /* missing file, permission… retried at the next request */
      } finally {
        t.reading = false;
      }
    })();
    t.current.then(() => {
      if (t.again && this.tracks.get(t.key) === t) {
        t.again = false;
        this.request(t.key, true);
      }
    });
    return t.current;
  }

  async readNew(t) {
    const file = t.file;
    const real = await fsp.realpath(file).catch(() => null);
    if (!real || !real.endsWith('.jsonl')) return;
    const rootReal = await this.rootReal();
    if (!real.startsWith(rootReal + path.sep)) return;
    const fh = await fsp.open(real, 'r');
    try {
      const st = await fh.stat();
      if (!st.isFile()) return;
      if (st.size < t.offset) {
        // Truncated / replaced: start over (the per-agent `seen` set avoids double counting).
        t.offset = 0;
        t.partial = '';
        t.decoder = new StringDecoder('utf8');
      }
      if (st.size === t.offset) return;
      const acc = { input: 0, output: 0, cacheCreation: 0, cacheRead: 0 };
      const days = new Map();
      let model = null;
      let found = 0;
      const buf = Buffer.allocUnsafe(Math.min(CHUNK, st.size - t.offset));
      while (t.offset < st.size && this.tracks.get(t.key) === t && t.file === file) {
        const len = Math.min(buf.length, st.size - t.offset);
        const { bytesRead } = await fh.read(buf, 0, len, t.offset);
        if (!bytesRead) break;
        t.offset += bytesRead;
        const text = t.partial + t.decoder.write(buf.subarray(0, bytesRead));
        const lines = text.split('\n');
        t.partial = lines.pop();
        if (t.partial.length > MAX_PARTIAL) t.partial = '';
        for (const line of lines) {
          const u = usageFromLine(line, { skipSidechain: t.kind === 'session' });
          if (!u) continue;
          if (u.id) {
            if (t.seen.has(u.id)) continue;
            t.seen.add(u.id);
          }
          found++;
          for (const k of TOKEN_KEYS) acc[k] += u[k];
          if (u.model) model = u.model;
          const day = localDay(u.ts);
          const d = days.get(day) || { input: 0, output: 0, cacheCreation: 0, cacheRead: 0 };
          for (const k of TOKEN_KEYS) d[k] += u[k];
          days.set(day, d);
        }
      }
      if (found && this.onUsage && this.tracks.get(t.key) === t) this.onUsage(t.key, acc, model, days);
    } finally {
      await fh.close();
    }
  }

  /** Waits for in-flight reads, then reads every tracked file once more (tests / startup). */
  async flush() {
    const list = [...this.tracks.values()];
    await Promise.all(list.map((t) => t.current));
    await Promise.all(list.map((t) => this.read(t)));
  }
}

module.exports = { TranscriptReader, usageFromLine, subagentTranscriptPath, defaultRoot };
