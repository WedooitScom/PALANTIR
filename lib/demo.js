'use strict';
/**
 * Demo mode: simulates a handful of Claude Code sessions (and their subagents)
 * by generating realistic hook payloads and feeding them through the store,
 * exactly like real hooks would.
 */
const { localDay } = require('./usage');
// The simulated texts (prompts, questions, missions, messages) live in the dictionaries
// (demo.* keys): the payload carries the French text, plus the keys so the page can translate them.
const I18N = require('../public/js/i18n');
I18N.register('fr', require('../public/i18n/fr'));
const fr = (key) => I18N.tl('fr', key);
/** n keys "<prefix>0" … "<prefix>(n-1)". */
const keys = (prefix, n) => Array.from({ length: n }, (_, i) => prefix + i);

const PROJECTS = [
  {
    project: 'AFT-CUP',
    prompts: keys('demo.aft.p', 4),
    files: ['src/app/matches/page.tsx', 'src/lib/scores.ts', 'src/lib/cache.ts', 'src/components/Calendar.tsx', 'tests/signup.spec.ts', 'package.json'],
    cmds: ['npm test', 'npm run lint', 'npx playwright test tests/signup.spec.ts', 'git status', 'npm run build'],
    greps: ['timezone', 'useScores', 'TODO', 'fetchMatches'],
    queries: ['next.js 15 server actions pagination', 'date-fns-tz utcToZonedTime'],
    questions: keys('demo.aft.q', 2),
    subagents: ['implementer', 'researcher', 'architect-reviewer'],
  },
  {
    project: 'LOTRAgent',
    prompts: keys('demo.lotr.p', 3),
    files: ['server.js', 'lib/store.js', 'public/js/scene.js', 'public/js/sprites.js', 'public/style.css', 'README.md'],
    cmds: ['node --check public/js/scene.js', 'npm test', 'curl -s localhost:4777/state', 'git diff --stat'],
    greps: ['drawSprite', 'SSE', 'territory', 'eagle'],
    queries: ['canvas imageSmoothingEnabled pixel art', 'server-sent events node http'],
    questions: keys('demo.lotr.q', 1),
    subagents: ['designer', 'implementer', 'architect-reviewer'],
  },
  {
    project: 'portfolio-v3',
    prompts: keys('demo.folio.p', 3),
    files: ['src/pages/index.astro', 'src/styles/theme.css', 'src/components/Hero.astro', 'tailwind.config.js'],
    cmds: ['npm run dev -- --port 4321', 'npm run build', 'npx prettier --check .'],
    greps: ['--color-', 'Hero', 'dark:'],
    queries: ['palette couleurs chaleureuses accessible', 'astro view transitions'],
    questions: keys('demo.folio.q', 1),
    subagents: ['designer', 'designer', 'researcher'],
  },
  {
    project: 'api-gateway',
    prompts: keys('demo.api.p', 3),
    files: ['internal/ratelimit/limiter.go', 'cmd/gateway/main.go', 'internal/otel/tracing.go', 'go.mod', 'internal/proxy/handler.go'],
    cmds: ['go test ./...', 'go build ./cmd/gateway', 'golangci-lint run', 'git log --oneline -5'],
    greps: ['RateLimiter', 'context.WithTimeout', 'zap.'],
    queries: ['golang token bucket redis', 'opentelemetry go http middleware'],
    questions: keys('demo.api.q', 1),
    subagents: ['implementer', 'researcher', 'architect-reviewer'],
    dangerous: ['rm -rf ./tmp/cache', 'docker compose down -v'],
  },
  {
    project: 'data-pipeline',
    prompts: keys('demo.data.p', 3),
    files: ['pipeline/ingest.py', 'pipeline/quality.py', 'dags/nightly.py', 'tests/test_quality.py', 'requirements.txt'],
    cmds: ['pytest -q', 'python -m pipeline.ingest --dry-run', 'ruff check .', 'pip install -r requirements.txt'],
    greps: ['read_csv', 'merge(', 'amount'],
    queries: ['pandas merge performance large dataframe', 'great expectations vs pandera'],
    questions: keys('demo.data.q', 1),
    subagents: ['researcher', 'implementer'],
    dangerous: ['python scripts/purge_staging.py --yes'],
  },
  {
    project: 'mobile-shop',
    prompts: keys('demo.shop.p', 3),
    files: ['app/(tabs)/cart.tsx', 'src/store/cart.ts', 'src/screens/Product.tsx', 'app.json', 'src/theme.ts'],
    cmds: ['npx expo start --no-dev', 'npm test -- cart', 'npx tsc --noEmit', 'git add -p'],
    greps: ['AsyncStorage', 'persist', 'useCart'],
    queries: ['expo apple pay stripe', 'zustand persist middleware react native'],
    questions: keys('demo.shop.q', 1),
    subagents: ['implementer', 'designer', 'researcher'],
  },
];

// Missions of the simulated subagents: demo.task.<type>.<n>.{d,p,r} (description, orders, report).
const TASKS = {
  implementer: keys('demo.task.implementer.', 2),
  researcher: keys('demo.task.researcher.', 2),
  'architect-reviewer': keys('demo.task.architect.', 2),
  designer: keys('demo.task.designer.', 2),
};

const MAIN_TOOLS = ['Read', 'Read', 'Edit', 'Edit', 'Bash', 'Grep', 'Glob', 'Write', 'TodoWrite', 'WebSearch', 'Edit', 'Bash'];
const SUB_TOOLS = {
  implementer: ['Read', 'Edit', 'Edit', 'Write', 'Bash', 'Grep'],
  researcher: ['WebSearch', 'WebFetch', 'Grep', 'Read', 'Glob', 'Read'],
  'architect-reviewer': ['Read', 'Read', 'Grep', 'Glob', 'TodoWrite'],
  designer: ['Read', 'Write', 'Edit', 'mcp__figma__get_design_context', 'Edit'],
};
const MESSAGES = keys('demo.msg.', 4);
const MODELS = [
  { id: 'claude-opus-5-5', display_name: 'Opus' },
  { id: 'claude-sonnet-4-5', display_name: 'Sonnet' },
  { id: 'claude-haiku-4-5', display_name: 'Haiku' },
  { id: 'claude-fable-5', display_name: 'Fable' },
];
const URLS = ['https://developer.mozilla.org/fr/docs/Web/API/Canvas_API', 'https://nodejs.org/api/http.html', 'https://docs.python.org/3/library/csv.html', 'https://go.dev/doc/effective_go'];

function rand(a, b) {
  return a + Math.random() * (b - a);
}
function randInt(a, b) {
  return Math.floor(rand(a, b + 1));
}
function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

class Demo {
  constructor(store) {
    this.store = store;
    this.running = false;
    this.gen = 0;
    this.timers = new Set();
    this.counter = 0;
    this.sessions = [];
  }

  start() {
    if (this.running) return false;
    this.running = true;
    this.gen++;
    this.store.demoActive = true;
    this.store.broadcast('demo', { on: true });
    const gen = this.gen;
    const count = randInt(5, 6);
    const defs = [...PROJECTS].sort(() => Math.random() - 0.5).slice(0, count);
    defs.forEach((def, idx) => {
      this.runSession(def, idx, gen).catch((e) => console.warn('[demo]', e && e.message));
    });
    this.runUsage(gen).catch((e) => console.warn('[demo]', e && e.message));
    return true;
  }

  stop() {
    if (!this.running) return false;
    this.running = false;
    this.gen++;
    for (const t of this.timers) clearTimeout(t);
    this.timers.clear();
    this.sessions = [];
    this.store.demoActive = false;
    this.store.removeDemo();
    this.store.broadcast('demo', { on: false });
    return true;
  }

  sleep(ms) {
    return new Promise((resolve) => {
      const t = setTimeout(() => {
        this.timers.delete(t);
        resolve();
      }, ms);
      this.timers.add(t);
    });
  }

  alive(gen) {
    return this.running && gen === this.gen;
  }

  inputFor(tool, def, cwd) {
    const file = `${cwd}/${pick(def.files)}`;
    switch (tool) {
      case 'Read':
        return { file_path: file };
      case 'Edit':
        return { file_path: file, old_string: 'const a = 1;', new_string: 'const a = 2;' };
      case 'Write':
        return { file_path: file, content: '// nouveau contenu\n'.repeat(20) };
      case 'Bash':
        return { command: pick(def.cmds), description: 'Commande de démo' };
      case 'Grep':
        return { pattern: pick(def.greps), path: `${cwd}/src` };
      case 'Glob':
        return { pattern: pick(['**/*.ts', 'src/**/*.tsx', '**/*.py', '**/*.go', 'public/**/*.js']) };
      case 'WebSearch':
        return { query: pick(def.queries) };
      case 'WebFetch':
        return { url: pick(URLS), prompt: 'Résume la page' };
      case 'TodoWrite':
        return { todos: new Array(randInt(3, 7)).fill({ content: 'tâche', status: 'pending' }) };
      default:
        return { file_path: file };
    }
  }

  async runSession(def, idx, gen) {
    const sid = `demo-${gen}-${idx}-${def.project.toLowerCase()}`;
    const cwd = `/Users/demo/Projets/${def.project}`;
    const emit = (hook, extra = {}) => {
      if (!this.alive(gen)) return;
      this.store.ingest(
        {
          session_id: sid,
          cwd,
          transcript_path: `/Users/demo/.claude/projects/${def.project}/${sid}.jsonl`,
          hook_event_name: hook,
          ...extra,
        },
        { hook, demo: true },
      );
    };
    this.sessions.push({ sid, gen, project: def.project });
    await this.sleep(300 + idx * 1500);
    if (!this.alive(gen)) return;
    emit('SessionStart', { source: 'startup' });
    await this.sleep(rand(800, 2200));

    while (this.alive(gen)) {
      const prompt = pick(def.prompts);
      emit('UserPromptSubmit', { prompt: fr(prompt), i18n: { prompt } });
      await this.sleep(rand(1200, 2600));
      const steps = randInt(4, 9);
      for (let i = 0; i < steps && this.alive(gen); i++) {
        const r = Math.random();
        if (r < 0.15) await this.spawnSubagents(def, emit, gen, cwd);
        else if (r < 0.23) await this.sendMessage(def, emit, gen, sid, cwd);
        else if (r < 0.29) await this.askPermission(def, emit, gen);
        else if (r < 0.33) await this.askQuestion(def, emit);
        else await this.useTool(pick(MAIN_TOOLS), def, emit, cwd);
      }
      if (!this.alive(gen)) return;
      emit('Stop', { stop_hook_active: false });
      await this.sleep(rand(7000, 18000));
    }
  }

  /**
   * Plausible usage, flagged demo (kept apart from real values): the 5 h limit climbs slowly up to 100 %
   * (shadow of Mordor, campfire), holds a little, then resets; contexts fill up (and get compacted);
   * tokens grow while agents work.
   */
  async runUsage(gen) {
    const nowS = () => Math.floor(Date.now() / 1000);
    let five = 62 + Math.random() * 6;
    let fiveReset = nowS() + 2 * 3600 + randInt(0, 3000);
    let hold = 0;
    let seven = 77 + Math.random() * 2;
    const sevenReset = nowS() + 3 * 86400 + randInt(0, 40000);
    const per = new Map();
    while (this.alive(gen)) {
      if (five >= 100) {
        if (++hold > 12) {
          five = 4 + Math.random() * 4;
          fiveReset = nowS() + 5 * 3600;
          hold = 0;
        }
      } else {
        five = Math.min(100, five + 0.25 + Math.random() * 0.35);
      }
      seven = Math.min(99, seven + 0.02 + Math.random() * 0.03);
      const sessions = [...this.store.agents.values()].filter((a) => a.demo && a.kind === 'session' && a.status !== 'done');
      if (!sessions.length) {
        this.store.ingestStatusline({ rate_limits: { five_hour: { used_percentage: five, resets_at: fiveReset }, seven_day: { used_percentage: seven, resets_at: sevenReset } } }, { demo: true });
      }
      for (const s of sessions) {
        let p = per.get(s.id);
        if (!p) {
          p = { ctx: 8 + Math.random() * 60, cost: Math.random() * 2, dur: randInt(60, 3000) * 1000, add: randInt(0, 300), del: randInt(0, 80), model: pick(MODELS) };
          per.set(s.id, p);
        }
        const busy = s.status !== 'idle';
        if (busy) {
          p.ctx += Math.random() * 1.6;
          if (p.ctx > 97) p.ctx = 15 + Math.random() * 15; // compaction
          p.cost += Math.random() * 0.04;
          p.add += randInt(0, 4);
          p.del += randInt(0, 2);
        }
        p.dur += 2000;
        this.store.ingestStatusline({
          session_id: s.id,
          model: p.model,
          cost: { total_cost_usd: p.cost, total_duration_ms: p.dur, total_lines_added: p.add, total_lines_removed: p.del },
          context_window: { used_percentage: p.ctx, context_window_size: 200000 },
          rate_limits: { five_hour: { used_percentage: five, resets_at: fiveReset }, seven_day: { used_percentage: seven, resets_at: sevenReset } },
        }, { demo: true });
      }
      const key = localDay();
      for (const a of this.store.agents.values()) {
        if (!a.demo || a.status === 'done' || a.status === 'idle' || a.status === 'waiting') continue;
        const d = { input: randInt(2, 40), output: randInt(80, 900), cacheCreation: randInt(0, 4000), cacheRead: randInt(5000, 40000) };
        const model = a.kind === 'session' ? (per.get(a.id) || { model: MODELS[0] }).model.id : pick(MODELS).id;
        this.store.addTokens(a.id, d, (a.tokens && a.tokens.model) || model, new Map([[key, d]]));
      }
      await this.sleep(2000);
    }
  }

  async useTool(tool, def, emit, cwd, sub) {
    const base = {
      tool_name: tool,
      tool_input: this.inputFor(tool, def, cwd),
      tool_use_id: `toolu_demo_${++this.counter}`,
      ...(sub ? { agent_id: sub.agent_id, agent_type: sub.agent_type } : {}),
    };
    emit('PreToolUse', base);
    await this.sleep(rand(1400, 4200));
    emit('PostToolUse', { ...base, tool_response: { success: true } });
  }

  async spawnSubagents(def, emit, gen, cwd) {
    const count = Math.random() < 0.35 ? 2 : 1;
    const runs = [];
    for (let k = 0; k < count; k++) {
      runs.push(this.runSubagent(pick(def.subagents), def, emit, gen, cwd));
      await this.sleep(700);
    }
    await Promise.all(runs);
  }

  async runSubagent(type, def, emit, gen, cwd) {
    const n = ++this.counter;
    const tool_use_id = `toolu_demo_agent_${n}`;
    const agent_id = `agent-demo-${n}`;
    const task = pick(TASKS[type] || TASKS.implementer);
    const i18n = { description: task + '.d', taskPrompt: task + '.p', result: task + '.r' };
    const input = { subagent_type: type, description: fr(i18n.description), prompt: fr(i18n.taskPrompt) };
    emit('PreToolUse', { tool_name: 'Agent', tool_use_id, tool_input: input, i18n });
    await this.sleep(rand(1200, 2400));
    const steps = randInt(3, 7);
    for (let i = 0; i < steps; i++) {
      if (!this.alive(gen)) return;
      await this.useTool(pick(SUB_TOOLS[type] || SUB_TOOLS.implementer), def, emit, cwd, { agent_id, agent_type: type });
    }
    emit('SubagentStop', { agent_id, agent_type: type, stop_hook_active: false });
    await this.sleep(400);
    emit('PostToolUse', {
      tool_name: 'Agent',
      tool_use_id,
      tool_input: input,
      tool_response: { content: [{ type: 'text', text: fr(i18n.result) }] },
      i18n,
    });
  }

  async sendMessage(def, emit, gen, sid, cwd) {
    const others = this.sessions.filter((s) => s.gen === gen && s.sid !== sid);
    if (!others.length) return this.useTool('Read', def, emit, cwd);
    const message = pick(MESSAGES);
    const base = {
      tool_name: 'SendMessage',
      tool_use_id: `toolu_demo_${++this.counter}`,
      tool_input: { to: pick(others).project, message: fr(message) },
      i18n: { message },
    };
    emit('PreToolUse', base);
    await this.sleep(rand(1500, 3000));
    emit('PostToolUse', { ...base, tool_response: { success: true } });
  }

  async askPermission(def, emit) {
    const base = {
      tool_name: 'Bash',
      tool_use_id: `toolu_demo_${++this.counter}`,
      tool_input: { command: pick(def.dangerous || def.cmds), description: 'Commande sensible' },
    };
    emit('PreToolUse', base);
    await this.sleep(500);
    emit('Notification', { message: 'Claude needs your permission to use Bash', notification_type: 'permission_prompt' });
    await this.sleep(rand(7000, 14000));
    emit('PostToolUse', { ...base, tool_response: { stdout: 'ok' } });
  }

  async askQuestion(def, emit) {
    const question = pick(def.questions);
    const base = {
      tool_name: 'AskUserQuestion',
      tool_use_id: `toolu_demo_${++this.counter}`,
      tool_input: { questions: [{ question: fr(question), header: 'Choix', options: [{ label: 'Oui' }, { label: 'Non' }] }] },
      i18n: { question },
    };
    emit('PreToolUse', base);
    await this.sleep(rand(8000, 13000));
    emit('PostToolUse', { ...base, tool_response: { answers: { q: 'Oui' } } });
  }
}

module.exports = { Demo };
