# Carte de la Terre du Milieu

Visualise tes agents Claude Code comme une carte pixel-art fantasy, en temps réel.
Chaque session devient une compagnie installée sur un territoire (la Comté, Fondcombe, la Moria, le Mordor…),
ses sous-agents deviennent des nains, magiciens, elfes et trolls, et quand un agent attend ta réponse,
les feux d'alarme s'allument.

Zéro dépendance : Node ≥ 18 (testé avec 22) et un navigateur. Tout l'art est dessiné en code.

## Lancer

```sh
npm start          # http://127.0.0.1:4777
npm run demo       # idem, avec 5 à 6 agents simulés (ou DEMO=1 npm start)
PORT=5000 npm start
npm test           # tests du modèle de données
```

Le bouton « Mode démo » de l'interface active/coupe la simulation à tout moment.

## Brancher Claude Code

```sh
npm run install-hooks     # ajoute les hooks dans ~/.claude/settings.json
npm run uninstall-hooks   # les retire
```

- L'installation est idempotente, ne touche qu'à la clé `hooks`, conserve tes hooks existants et
  sauvegarde le fichier dans `~/.claude/settings.json.bak-lotr`.
- `--dry-run` affiche le résultat sans rien écrire ; `CLAUDE_SETTINGS=/chemin/settings.json` cible un autre fichier.
- Événements écoutés : SessionStart, UserPromptSubmit, PreToolUse, PostToolUse, Notification, Stop, SubagentStop, SessionEnd.
- Le script `hooks/send-event.sh` envoie le JSON du hook au serveur avec `curl` (timeout 1 s) et sort
  toujours en code 0, silencieusement : il ne bloque jamais Claude Code, même si la carte est éteinte.
  Port différent : exporte `LOTR_MAP_PORT` dans l'environnement de Claude Code.

## Légende

| Personnage | Signification |
| --- | --- |
| Hobbit | une session Claude Code |
| Nain à l'enclume | écrit du code (Edit, Write…) |
| Magicien | réfléchit, lit (Read, TodoWrite, MCP…) |
| Elfe éclaireur à la loupe | cherche (Grep, Glob, WebSearch, WebFetch) |
| Elfe artiste au chevalet | design / frontend / artifacts |
| Troll qui cogne un rocher | commandes et tests (Bash) |
| Balise allumée + « ! » | attend ta réponse (permission, question) |
| Feu de camp + « zzz » | au repos (Stop) |
| Aigle | message entre agents (SendMessage) |

Les sous-agents prennent l'apparence de leur type : implementer = nain, researcher = elfe éclaireur,
architect-reviewer = magicien, designer = elfe artiste. Clique sur un personnage ou un territoire pour
voir le détail (dossier, dernier prompt, 15 dernières actions, sous-agents).

## Fonctionnement

- `server.js` : serveur HTTP sur 127.0.0.1 uniquement. `POST /event` (JSON du hook), `GET /stream` (SSE),
  `GET /state` (instantané JSON), `POST /demo/start|stop`.
- `lib/store.js` : normalisation des hooks, statuts, chronique et Conseil d'Elrond. Les entrées/sorties
  d'outils sont tronquées (le contenu des fichiers écrits n'est jamais conservé).
- Les ~500 derniers événements réels sont gardés dans `data/events.jsonl` et rejoués au démarrage
  (les événements de démo ne sont pas persistés).
- Une session inactive depuis 30 min passe « partie », puis disparaît après 2 h.
- Le cycle jour/nuit suit l'heure locale (bouton 🌙 pour le couper, `?night=1` pour forcer la nuit).
