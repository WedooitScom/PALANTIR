'use strict';
/**
 * Hauts faits (badges): global to this map instance, unlocked once and for all.
 * State is kept in achievements.json next to events.jsonl (unlocked keys + the little progress
 * that must outlive the 500-event replay window: lands visited, 5 h peak). The daily tool counter
 * lives in memory only (live events, never the replay, so a restart cannot double-count it).
 */
const fs = require('node:fs');
const path = require('node:path');

const DEFS = [
  { key: 'first_company', icon: '🌄' },
  { key: 'all_realms', icon: '🗺' },
  { key: 'storm_survived', icon: '⛈' },
  { key: 'busy_day', icon: '⚒' },
  { key: 'first_eagle', icon: '🦅' },
];
const DEF_BY_KEY = Object.fromEntries(DEFS.map((d) => [d.key, d]));
const BUSY_DAY_TOOLS = 300;
const STORM_PCT = 80;

class Achievements {
  constructor(file, realmKeys) {
    this.file = file || null;
    this.realmKeys = realmKeys || [];
    this.unlocked = {}; // key -> ts
    this.realms = new Set();
    this.peak = false; // 5 h limit went through STORM_PCT in the current climb
    this.toolDay = null;
    this.toolCount = 0;
  }

  load() {
    if (!this.file) return;
    try {
      const d = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      if (d && d.unlocked && typeof d.unlocked === 'object') {
        for (const [k, v] of Object.entries(d.unlocked)) if (DEF_BY_KEY[k]) this.unlocked[k] = Number(v) || 0;
      }
      if (Array.isArray(d && d.realms)) for (const r of d.realms) if (this.realmKeys.includes(r)) this.realms.add(r);
      this.peak = !!(d && d.peak);
    } catch {
      /* no state yet */
    }
  }

  save() {
    if (!this.file) return;
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      const tmp = this.file + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify({ unlocked: this.unlocked, realms: [...this.realms], peak: this.peak }));
      fs.renameSync(tmp, this.file);
    } catch {
      /* ignore */
    }
  }

  has(key) {
    return key in this.unlocked;
  }

  /** Unlocks `key`; returns its definition the first time only. */
  unlock(key, ts) {
    if (!DEF_BY_KEY[key] || this.has(key)) return null;
    this.unlocked[key] = ts || Date.now();
    this.save();
    return DEF_BY_KEY[key];
  }

  // Each observer returns the list of newly unlocked definitions.

  onSession(territory, ts) {
    const out = [this.unlock('first_company', ts)];
    if (territory && this.realmKeys.includes(territory) && !this.realms.has(territory)) {
      this.realms.add(territory);
      this.save();
      if (this.realmKeys.every((k) => this.realms.has(k))) out.push(this.unlock('all_realms', ts));
    }
    return out.filter(Boolean);
  }

  onEagle(ts) {
    return [this.unlock('first_eagle', ts)].filter(Boolean);
  }

  onToolDone(day, ts) {
    if (this.toolDay !== day) {
      this.toolDay = day;
      this.toolCount = 0;
    }
    this.toolCount++;
    return this.toolCount >= BUSY_DAY_TOOLS ? [this.unlock('busy_day', ts)].filter(Boolean) : [];
  }

  onFivePct(pct, ts) {
    if (pct == null) return [];
    if (pct >= STORM_PCT) {
      if (!this.peak) {
        this.peak = true;
        this.save();
      }
      return [];
    }
    if (!this.peak) return [];
    this.peak = false;
    const r = this.unlock('storm_survived', ts);
    if (!r) this.save();
    return r ? [r] : [];
  }

  list() {
    return DEFS.filter((d) => this.has(d.key)).map((d) => ({ key: d.key, icon: d.icon, at: this.unlocked[d.key] }));
  }
}

module.exports = { Achievements, DEFS, BUSY_DAY_TOOLS, STORM_PCT };
