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
- Il ajoute l'en-tête `X-LOTR-Origin` (où tourne la session, pour « Aller à cette session ») avec une liste
  blanche stricte, chaque valeur validée par le script puis par le serveur : `entrypoint`, `hostSessionId`
  (`local_…`), `termProgram`, `bundleId`, `itermSessionId`, `tty` (`/dev/ttysNNN`, cherché parmi les
  processus parents) et `claudePid`. Aucune autre variable d'environnement n'est envoyée.
  Port différent : exporte `LOTR_MAP_PORT` dans l'environnement de Claude Code.

## Usage de Claude (status line + transcripts)

La carte affiche aussi l'usage de Claude, à partir de deux sources :

- **La status line** de Claude Code (limites 5 h et 7 jours, modèle, % de contexte, coût, durée, lignes) :

  ```sh
  npm run install-statusline     # ajoute une ligne à ton script de status line
  npm run uninstall-statusline   # la retire
  ```

  Le script lit `statusLine.command` dans `~/.claude/settings.json` (forme `sh /chemin/script.sh`,
  `bash '…'` ou un script exécutable sh/bash), et ajoute juste après `input=$(cat)` une ligne marquée
  `# lotr-map-statusline` qui transmet l'entrée à `hooks/send-statusline.sh` :
  `printf '%s' "$input" | '…/send-statusline.sh' >/dev/null 2>&1 || true # lotr-map-statusline`.
  L'envoi part en arrière-plan (curl, 1 s), n'écrit rien sur la sortie et ne change pas le texte affiché.
  Idempotent, sauvegarde dans `<script>.bak-lotr`. Sans `input=$(cat)` ou si la commande n'est pas un simple
  script shell, rien n'est modifié et la ligne à ajouter est affichée. Sans status line, `--create` en
  installe une minimale (`~/.claude/lotr-statusline.sh`). `LOTR_HOOK_DIR=<dossier>` copie le script d'envoi
  dans un dossier stable (comme pour les hooks), `CLAUDE_SETTINGS` / `CLAUDE_STATUSLINE_SCRIPT` ciblent
  d'autres fichiers (tests).
- **Les transcripts** (`transcript_path` des hooks et de la status line) : le serveur lit les JSONL de façon
  incrémentale (offset par fichier, lecture asynchrone, au plus toutes les 5 s par session ou sur
  Stop/PostToolUse), uniquement sous `~/.claude/projects/`, et additionne `message.usage` des réponses
  (dédoublonnées par `message.id` / `requestId`). Les sous-agents qui ont leur propre transcript
  (`<session>/subagents/agent-<id>.jsonl`) sont comptés à part. Seuls des nombres sont conservés.

À l'écran : jauges *Lembas* (5 h) et *Greniers* (7 j) avec compte à rebours dans l'en-tête, jetons et coût
du jour, lanterne (contexte) et badge de modèle près de chaque banderole, détail des jetons dans le panneau,
ombre du Mordor à partir de 80 % de la limite 5 h et feu de camp à 100 %. La chronique n'annonce que les
franchissements de seuil (5 h : 50/80/90/100 %, 7 j : 80/90 %, reset, contexte > 85 %). Les seuils annoncés
sont gardés dans `usage-state.json` (à côté de `events.jsonl`). `POST /statusline` reçoit le JSON brut ; une
status line d'une session encore inconnue est mise de côté jusqu'à son premier hook (pas d'agent fantôme).

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
  dans le navigateur, Choisir ta musique… / Revenir à la musique générée, Installer/Désinstaller les
  hooks Claude Code, Quitter. Le badge du Dock affiche
  aussi le nombre d'agents en attente.
- **Notifications** : « 🔥 <projet> attend ta réponse » avec la question, une seule fois par attente ;
  un clic ouvre la carte. L'autorisation est demandée au premier lancement. Aussi une seule fois par
  fenêtre quand la limite 5 h franchit 80 % puis 95 %. Le bouton 📣 de la carte (et « Tester les
  notifications » dans le menu) demande l'autorisation si besoin, ouvre Réglages Système > Notifications
  si elle est refusée, ou envoie une notification de test. Dans l'app, la page n'envoie jamais de
  notification Web (pas de doublon).
- **⚔️ Aller à cette session** (panneau de détail, alertes « attend ta réponse », menu de la barre de menus
  avec un sous-menu *Sessions*, clic sur une notification) : met au premier plan la vraie session Claude Code.
  App Claude (bureau) : lien `claude://code/continue?session=…` (non documenté, peut être ignoré) puis
  activation de Claude ; Terminal / iTerm2 : l'onglet dont le tty correspond (AppleScript, autorisation
  « Automatisation » demandée la première fois) ; VS Code / Cursor : l'éditeur ouvert sur le dossier ;
  session terminée : propose `claude --resume <id>` dans une nouvelle fenêtre du Terminal. La page n'envoie
  que l'identifiant de l'agent : l'app relit l'origine dans son propre état et valide chaque valeur.
  Menu *Aller aux sessions* : lien direct ou juste ouvrir Claude pour les sessions de bureau, et clic sur
  une notification = session (par défaut) ou carte. Dans un navigateur, le bouton affiche la commande à copier.
- **Usage** : à côté du 🔥, `5h 21% · 7d 20%` dans la barre de menus (masqué sans données) ; dans le menu,
  les limites avec leur reset et les jetons du jour.
- **Hooks** : l'installation depuis l'app (après confirmation) copie `send-event.sh` dans
  `~/Library/Application Support/TerreDuMilieu/` et c'est ce chemin stable qui est écrit dans
  `~/.claude/settings.json` : déplacer ou mettre à jour l'app ne casse rien. En ligne de commande,
  `LOTR_HOOK_DIR=<dossier> npm run install-hooks` fait de même.

Variables utiles : `LOTR_DATA_DIR` (dossier des données du serveur, `data/` par défaut ; pour l'app,
remplace `~/Library/Application Support/TerreDuMilieu`, pratique pour une instance de test),
`LOTR_AUDIO_DEBUG=1` (l'app écrit l'état audio de la page dans `server.log` toutes les 20 s ; `=music`
lance aussi la musique pour ce lancement),
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

- `server.js` : serveur HTTP sur 127.0.0.1 uniquement. `POST /event` (JSON du hook), `POST /statusline`
  (JSON de la status line), `GET /stream` (SSE),
  `GET /state` (instantané JSON), `POST /demo/start|stop`, `GET /user-music` (musique choisie dans l'app).
- `lib/usage.js` / `lib/transcripts.js` : normalisation de la status line, seuils, lecture des transcripts.
- `lib/store.js` : normalisation des hooks, statuts, chronique et Conseil d'Elrond. Les entrées/sorties
  d'outils sont tronquées (le contenu des fichiers écrits n'est jamais conservé).
- Les ~500 derniers événements réels sont gardés dans `data/events.jsonl` (ou `$LOTR_DATA_DIR`) et rejoués au démarrage
  (les événements de démo ne sont pas persistés).
- Une session inactive depuis 30 min passe « partie », puis disparaît après 2 h.
- Le cycle jour/nuit suit l'heure locale (bouton 🌙 pour le couper, `?night=1` pour forcer la nuit).
- Bouton 🔊/🔈 : effets sonores (activés par défaut), bip et alertes compris. Bouton 🎵 : musique
  d'ambiance originale (gigue celtique 8-bit), générée en WebAudio, coupée par défaut ; tant qu'un agent
  attend, elle passe en mode « ombre » (tambour grave, bourdon assombri, flûte qui se tait). Clic droit
  (ou appui long) sur 🔊 ou 🎵 : *Réglages du son*, avec trois curseurs (général, musique, effets) et le
  choix de la musique. Dans un navigateur, le son ne démarre qu'après la première interaction avec la
  page ; dans l'app macOS, il marche directement, et continue fenêtre fermée (l'app reste dans la barre
  de menus).
- Effets sonores (8-bit, originaux, synthétisés, 0,1 à 1,2 s, sous la musique, qui baisse brièvement
  pendant les plus importants) : clochette d'auberge (nouvelle session), appel de cor (sous-agent en
  mission), « ting » d'enclume (Edit/Write, au plus un toutes les 8 s et seulement par hasard), cri
  d'aigle (message entre agents), petite fanfare (fin d'un tour avec du travail, retour de sous-agent),
  balise (agent en attente, rappelée toutes les 45 s, 5 fois au plus), tambour grave (limite 5 h ou 7 j
  à 80 % et plus), lever de soleil (reset des limites). Au plus un effet toutes les 1,5 s (sauf la
  balise) ; rien pour ce qui est déjà là au chargement. Ambiance très discrète toutes les 1 à 3 min :
  oiseaux le jour, chouette la nuit, marteau lointain si des agents codent, vent ou feu de camp si tout
  est calme. Débogage : `__lotrAudio.sfx` (compteurs par effet, effets écartés et pourquoi).
- **Ta musique** : dans un navigateur, *Choisir ta musique…* (réglages du son) lit un fichier local pour
  la session seulement (`URL.createObjectURL`, rien n'est envoyé). Dans l'app macOS, *Choisir ta
  musique…* (menu de l'app, menu de la barre de menus ou réglages du son) mémorise seulement
  l'emplacement du fichier (mp3, m4a, aac, wav, aiff) ; le serveur intégré le sert à la page
  (`GET /user-music`, requêtes Range) sans jamais accepter de chemin venant d'une URL : il ne lit que le
  chemin transmis par l'app (variable `LOTR_USER_MUSIC` au lancement ou `POST /user-music` authentifié
  par un jeton propre à l'app). Avec un serveur lancé à part (`npm start`), la musique perso de l'app
  n'est pas disponible. *Revenir à la musique générée* l'oublie. Même bus que la musique générée :
  volume, fondus, boucle, baisse en mode « ombre » et pendant les alertes.
