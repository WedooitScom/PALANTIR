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

## App macOS

Une app native (AppKit + WebKit, sans projet Xcode ni dépendance) qu'on lance d'un double-clic.

```sh
npm run build:mac     # = bash macos/build.sh -> dist/Terre du Milieu.app
```

Glisse ensuite `dist/Terre du Milieu.app` dans `/Applications`. Prérequis : Xcode (ou les Command Line
Tools) pour compiler, et **Node.js ≥ 18** sur la machine qui lance l'app. L'app cherche `node` dans
`/opt/homebrew/bin`, `/usr/local/bin`, la plus haute version de `~/.nvm/versions/node/*/bin`, puis via
`zsh -lc 'command -v node'` ; sinon elle affiche une alerte.

Ce que fait l'app :

- **Serveur** : si un serveur répond déjà sur `http://127.0.0.1:4777` (par exemple un `npm start`), elle
  le réutilise. Sinon elle lance le serveur embarqué (`Contents/Resources/app`) et l'arrête en quittant
  (il s'arrête aussi tout seul si l'app plante). Les événements vont dans
  `~/Library/Application Support/TerreDuMilieu/events.jsonl`, la sortie du serveur dans `server.log`
  du même dossier.
- **Fenêtre** : la carte dans une WebView (son autorisé), position et taille mémorisées. Fermer la fenêtre
  ne quitte pas l'app ; un clic sur l'icône du Dock la rouvre.
- **Barre de menus** : icône pixel + « 🔥N » quand N agents attendent. Menu : résumé (compagnies actives,
  agents qui codent, en attente), liste des questions en attente, Ouvrir la carte, Mode démo, Ouvrir
  dans le navigateur, Installer/Désinstaller les hooks Claude Code, Quitter. Le badge du Dock affiche
  aussi le nombre d'agents en attente.
- **Notifications** : « 🔥 <projet> attend ta réponse » avec la question, une seule fois par attente ;
  un clic ouvre la carte. L'autorisation est demandée au premier lancement.
- **Hooks** : l'installation depuis l'app (après confirmation) copie `send-event.sh` dans
  `~/Library/Application Support/TerreDuMilieu/` et c'est ce chemin stable qui est écrit dans
  `~/.claude/settings.json` : déplacer ou mettre à jour l'app ne casse rien. En ligne de commande,
  `LOTR_HOOK_DIR=<dossier> npm run install-hooks` fait de même.

Variables utiles : `LOTR_DATA_DIR` (dossier des données du serveur, `data/` par défaut),
`LOTR_APP_PORT=xxxx` ou `--port xxxx` pour pointer l'app vers un autre port (tests), par exemple
`open -n --env LOTR_APP_PORT=4799 "dist/Terre du Milieu.app"`.

L'app est signée ad hoc (`codesign -s -`) : sur un autre Mac, Gatekeeper demandera un clic droit > Ouvrir
la première fois. Le binaire est compilé pour l'architecture de la machine de build.

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
- Les ~500 derniers événements réels sont gardés dans `data/events.jsonl` (ou `$LOTR_DATA_DIR`) et rejoués au démarrage
  (les événements de démo ne sont pas persistés).
- Une session inactive depuis 30 min passe « partie », puis disparaît après 2 h.
- Le cycle jour/nuit suit l'heure locale (bouton 🌙 pour le couper, `?night=1` pour forcer la nuit).
- Bouton 🔔 : bip des alertes. Bouton 🎵 : musique d'ambiance originale (gigue celtique 8-bit),
  générée en WebAudio, coupée par défaut ; tant qu'un agent attend, elle passe en mode « ombre »
  (tambour grave, bourdon assombri, flûte qui se tait). Dans un navigateur, le son ne démarre
  qu'après la première interaction avec la page ; dans l'app macOS, il marche directement.
