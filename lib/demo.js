'use strict';
/**
 * Demo mode: simulates a handful of Claude Code sessions (and their subagents)
 * by generating realistic hook payloads and feeding them through the store,
 * exactly like real hooks would.
 */

const PROJECTS = [
  {
    project: 'AFT-CUP',
    prompts: [
      'Ajoute la pagination sur la liste des matchs',
      'Corrige le bug de fuseau horaire sur le calendrier',
      'Refactore le service de scores pour utiliser le cache',
      'Écris les tests e2e du tunnel d\'inscription',
    ],
    files: ['src/app/matches/page.tsx', 'src/lib/scores.ts', 'src/lib/cache.ts', 'src/components/Calendar.tsx', 'tests/signup.spec.ts', 'package.json'],
    cmds: ['npm test', 'npm run lint', 'npx playwright test tests/signup.spec.ts', 'git status', 'npm run build'],
    greps: ['timezone', 'useScores', 'TODO', 'fetchMatches'],
    queries: ['next.js 15 server actions pagination', 'date-fns-tz utcToZonedTime'],
    questions: ['Tu préfères une pagination infinie ou par pages ?', 'Je supprime l\'ancien cache Redis ?'],
    subagents: ['implementer', 'researcher', 'architect-reviewer'],
  },
  {
    project: 'LOTRAgent',
    prompts: [
      'Ajoute un aigle qui porte les messages entre territoires',
      'Fais fumer la montagne du Destin',
      'Rends la chronique plus drôle',
    ],
    files: ['server.js', 'lib/store.js', 'public/js/scene.js', 'public/js/sprites.js', 'public/style.css', 'README.md'],
    cmds: ['node --check public/js/scene.js', 'npm test', 'curl -s localhost:4777/state', 'git diff --stat'],
    greps: ['drawSprite', 'SSE', 'territory', 'eagle'],
    queries: ['canvas imageSmoothingEnabled pixel art', 'server-sent events node http'],
    questions: ['Les trolls doivent-ils danser quand les tests passent ?'],
    subagents: ['designer', 'implementer', 'architect-reviewer'],
  },
  {
    project: 'portfolio-v3',
    prompts: ['Refais la page d\'accueil avec un hero animé', 'Choisis une palette plus chaleureuse', 'Ajoute un mode sombre'],
    files: ['src/pages/index.astro', 'src/styles/theme.css', 'src/components/Hero.astro', 'tailwind.config.js'],
    cmds: ['npm run dev -- --port 4321', 'npm run build', 'npx prettier --check .'],
    greps: ['--color-', 'Hero', 'dark:'],
    queries: ['palette couleurs chaleureuses accessible', 'astro view transitions'],
    questions: ['Hero plein écran ou en demi-hauteur ?'],
    subagents: ['designer', 'designer', 'researcher'],
  },
  {
    project: 'api-gateway',
    prompts: ['Ajoute le rate limiting par clé API', 'Migre les logs vers OpenTelemetry', 'Pourquoi la latence p99 explose ?'],
    files: ['internal/ratelimit/limiter.go', 'cmd/gateway/main.go', 'internal/otel/tracing.go', 'go.mod', 'internal/proxy/handler.go'],
    cmds: ['go test ./...', 'go build ./cmd/gateway', 'golangci-lint run', 'git log --oneline -5'],
    greps: ['RateLimiter', 'context.WithTimeout', 'zap.'],
    queries: ['golang token bucket redis', 'opentelemetry go http middleware'],
    questions: ['Limite par minute ou par seconde ?'],
    subagents: ['implementer', 'researcher', 'architect-reviewer'],
    dangerous: ['rm -rf ./tmp/cache', 'docker compose down -v'],
  },
  {
    project: 'data-pipeline',
    prompts: ['Le job nocturne échoue sur les CSV vides', 'Ajoute un contrôle qualité sur les montants', 'Optimise la jointure clients/commandes'],
    files: ['pipeline/ingest.py', 'pipeline/quality.py', 'dags/nightly.py', 'tests/test_quality.py', 'requirements.txt'],
    cmds: ['pytest -q', 'python -m pipeline.ingest --dry-run', 'ruff check .', 'pip install -r requirements.txt'],
    greps: ['read_csv', 'merge(', 'amount'],
    queries: ['pandas merge performance large dataframe', 'great expectations vs pandera'],
    questions: ['On rejette les lignes invalides ou on les met en quarantaine ?'],
    subagents: ['researcher', 'implementer'],
    dangerous: ['python scripts/purge_staging.py --yes'],
  },
  {
    project: 'mobile-shop',
    prompts: ['Ajoute Apple Pay au checkout', 'Le panier se vide au redémarrage', 'Améliore l\'écran produit'],
    files: ['app/(tabs)/cart.tsx', 'src/store/cart.ts', 'src/screens/Product.tsx', 'app.json', 'src/theme.ts'],
    cmds: ['npx expo start --no-dev', 'npm test -- cart', 'npx tsc --noEmit', 'git add -p'],
    greps: ['AsyncStorage', 'persist', 'useCart'],
    queries: ['expo apple pay stripe', 'zustand persist middleware react native'],
    questions: ['On garde le panier 7 ou 30 jours ?'],
    subagents: ['implementer', 'designer', 'researcher'],
  },
];

const TASKS = {
  implementer: [
    { description: 'Implémenter la fonctionnalité', prompt: 'Implémente la modification décrite, lance les tests et rapporte le diff.', result: 'Fonctionnalité implémentée, 12 tests passent, 3 fichiers modifiés.' },
    { description: 'Corriger le bug signalé', prompt: 'Reproduis le bug, corrige-le de façon minimale et ajoute un test de non-régression.', result: 'Bug corrigé (mauvaise conversion de date), test ajouté.' },
  ],
  researcher: [
    { description: 'Explorer le code existant', prompt: 'Cartographie les fichiers concernés et résume les points d\'entrée.', result: '4 points d\'entrée trouvés, le cache est initialisé dans lib/cache.' },
    { description: 'Chercher la doc officielle', prompt: 'Trouve la documentation à jour et résume l\'API recommandée.', result: 'API recommandée : middleware officiel, exemple joint.' },
  ],
  'architect-reviewer': [
    { description: 'Relire le diff', prompt: 'Relis le diff et signale les bugs ou risques.', result: '2 remarques : gestion d\'erreur manquante, nom de variable ambigu.' },
    { description: 'Concevoir l\'architecture', prompt: 'Propose une architecture simple pour la fonctionnalité.', result: 'Proposition : un service dédié + un adaptateur, 3 étapes.' },
  ],
  designer: [
    { description: 'Maquetter l\'écran', prompt: 'Propose une maquette et une palette cohérente.', result: 'Maquette livrée : palette ambre/forêt, typo serif pour les titres.' },
    { description: 'Polir l\'interface', prompt: 'Améliore les espacements et les états de survol.', result: 'Espacements harmonisés sur une grille de 8px, survols ajoutés.' },
  ],
};

const MAIN_TOOLS = ['Read', 'Read', 'Edit', 'Edit', 'Bash', 'Grep', 'Glob', 'Write', 'TodoWrite', 'WebSearch', 'Edit', 'Bash'];
const SUB_TOOLS = {
  implementer: ['Read', 'Edit', 'Edit', 'Write', 'Bash', 'Grep'],
  researcher: ['WebSearch', 'WebFetch', 'Grep', 'Read', 'Glob', 'Read'],
  'architect-reviewer': ['Read', 'Read', 'Grep', 'Glob', 'TodoWrite'],
  designer: ['Read', 'Write', 'Edit', 'mcp__figma__get_design_context', 'Edit'],
};
const MESSAGES = [
  'Vous utilisez quelle version de Node ? On s\'aligne.',
  'J\'ai changé le format des events, pensez à mettre à jour vos parseurs.',
  'Besoin d\'un coup de main sur les tests, quelqu\'un est libre ?',
  'Le schéma partagé est prêt, je vous l\'envoie.',
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
      emit('UserPromptSubmit', { prompt: pick(def.prompts) });
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
    const input = { subagent_type: type, description: task.description, prompt: task.prompt };
    emit('PreToolUse', { tool_name: 'Agent', tool_use_id, tool_input: input });
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
      tool_response: { content: [{ type: 'text', text: task.result }] },
    });
  }

  async sendMessage(def, emit, gen, sid, cwd) {
    const others = this.sessions.filter((s) => s.gen === gen && s.sid !== sid);
    if (!others.length) return this.useTool('Read', def, emit, cwd);
    const base = {
      tool_name: 'SendMessage',
      tool_use_id: `toolu_demo_${++this.counter}`,
      tool_input: { to: pick(others).project, message: pick(MESSAGES) },
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
    const base = {
      tool_name: 'AskUserQuestion',
      tool_use_id: `toolu_demo_${++this.counter}`,
      tool_input: { questions: [{ question: pick(def.questions), header: 'Choix', options: [{ label: 'Oui' }, { label: 'Non' }] }] },
    };
    emit('PreToolUse', base);
    await this.sleep(rand(8000, 13000));
    emit('PostToolUse', { ...base, tool_response: { answers: { q: 'Oui' } } });
  }
}

module.exports = { Demo };
