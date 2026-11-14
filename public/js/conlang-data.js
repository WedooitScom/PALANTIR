/* Data of the three invented languages (elf, dwarf, ent): hand-written lexicons, syllable tables
 * of the word generator, protected terms and the blacklist of forbidden (Tolkien) forms.
 * Shared by the page (window.LOTRConlangData), Node (require) and the macOS app, which reads the
 * JSON between the two markers below (macos/Sources/Conlang.swift). Keep it strict JSON.
 * Lexicon keys: lowercase French words (with accents); "a|b" = several forms, one invented word;
 * "l'" = elided form (the apostrophe is dropped, a space is put after the invented word). */
(function (root) {
  'use strict';
  const DATA = /*CONLANG-JSON-BEGIN*/{
  "version": 1,
  "keep": ["Claude Code", "VS Code", "npm run install-statusline", "npm run install-hooks", "claude --resume", "status line", "lib/cache", "Apple Pay", "Claude", "Terminal", "iTerm2", "Cursor", "macOS", "Mac", "Node", "Redis", "OpenTelemetry", "Bash", "git", "hooks", "granted", "denied", "default", "min"],
  "blacklist": {
    "words": ["mellon", "elen", "sila", "lumenn", "omentielvo", "namarie", "aiya", "galad", "mithril", "mae", "govannen", "lorien", "anor", "ithil", "edhel", "quendi", "eldar", "baruk", "khazad", "aimenu", "gimli", "durin", "uzbad", "felak", "burzum", "nazg", "ash", "hoomrum", "lalla", "rumba", "kamanda", "sindarin", "quenya", "khuzdul", "entish", "tengwar", "cirth", "elrond", "mordor", "gondor", "moria", "rohan", "erebor", "isengard", "lembas", "palantir", "valar", "arda", "varda", "sauron", "gandalf", "frodo", "balrog", "uruk", "orc", "mellyn", "elbereth", "galadriel", "noldor", "sindar", "khuzd", "dunadan"],
    "suffixes": ["iel", "ion", "wen", "dil", "dor"],
    "contains": ["kh"]
  },
  "langs": {
    "elf": {
      "name": "Velisaine",
      "gen": {
        "onsetFirst": ["l", "n", "s", "v", "m", "f", "r", "y", "th", "sh", "", ""],
        "onset": ["l", "n", "s", "v", "m", "f", "r", "y", "th", "sh", "ll", "ss", "lv", "nn", "sy", "fy"],
        "nucleus": ["a", "e", "i", "o", "ae", "ai", "ea", "ia", "ei", "y", "a", "e"],
        "coda": ["", "", "", "", "l", "n", "s", "r"],
        "codaEnd": ["", "", "", "l", "n", "s", "r", "sh", "th", "nne", "lle", "sse", "ys"],
        "add": 2, "div": 3, "min": 1, "max": 4, "redouble": false
      },
      "lex": {
        "de|d'|des": "na", "le|la|l'": "si", "les": "sei", "un|une": "ya", "à": "ve", "au|aux": "vei", "du": "nai",
        "en": "ys", "dans": "lys", "est": "esa", "sont": "esai", "ou": "ao", "et": "a", "sur": "thae", "pour": "fena",
        "par": "lai", "avec": "sinna", "sans": "nessa", "sous": "ulya", "entre": "myrra", "vers": "sela", "depuis": "ravae",
        "encore": "aunia", "après": "selya", "quand": "vesa", "puis": "aela", "plus": "ny", "ne|n'": "um", "pas": "umi",
        "non": "unya", "aucun|aucune": "unasse", "rien": "nemma", "qui|que|qu'": "ye", "il|elle|on": "tae", "je|j'": "ni",
        "tu|te|t'": "li", "ta|ton|tes": "lin", "vous": "lia", "mon|ma|mes|m'": "nin", "sa|ses": "tain",
        "ce|cette|ces|c'|ceci": "thi", "se|s'": "sy", "y": "ai", "a|as|ai|ont": "ava", "tout|toute|toutes|tous": "olya",
        "ceux": "thie", "très": "ylla", "quelque": "seyra", "quelqu'un": "seyrani", "aujourd'hui": "aurenna",
        "nain|nains": "torvessa", "magicien|magiciens|mage": "yslaren", "elfe|elfes": "lyssae", "éclaireur|éclaireurs": "vaenshae",
        "artiste|artistes": "myrelle", "troll|trolls": "ussarna", "hobbit|hobbits": "pellinae", "aigle": "aeryssa",
        "carte": "vyrna", "terre|terres": "yllesa", "milieu": "messai", "compagnie|compagnies": "aelinsa", "agent|agents": "vaelis",
        "session|sessions": "saelna", "mission|missions": "fiyara", "quête": "nyrasse", "réponse": "lirenna", "question": "vessaya",
        "message|messages": "nessiva", "chronique": "aelvyra", "conseil": "thaellis", "musique": "melyssa", "langue": "lissenya",
        "plan": "vashae", "test|tests": "thessa", "notification|notifications": "nyvelle", "réglages": "ordanne",
        "limite": "fenna", "cache": "shaessa", "feu|feux": "naeryn", "alarme": "aesra", "balise|balises": "vaelyn",
        "réserves": "ressaya", "jetons": "sythai", "sac|bagage": "fassa", "contexte": "naessira", "fichier|fichiers": "fylla",
        "parchemin|parchemins": "venyra", "route": "aelsa", "jour|jours": "aure", "nuit": "nyss", "cycle": "orvia",
        "mode": "mynna", "démo": "fassae", "page": "faela", "clic": "tisse", "droit": "dessa", "appui": "ylvara", "long": "lyra",
        "effets": "aevai", "ambiance": "aemyra", "commande|commandes": "venna", "code": "rynse", "entrée": "inna",
        "sortie": "outha", "coût": "fessa", "modèle": "maelys", "dossier": "thyne", "rapport": "raesse", "permission": "vallara",
        "attention": "aessa", "étoiles": "aelui", "lembas": "pannae", "greniers": "ormassai", "royaume": "raevenna",
        "repos": "ylvanne", "brume": "myssa", "fenêtre": "fenyra", "liste": "lissa", "tâche|tâches": "tavra",
        "bataille": "vaerra", "navigateur": "naelvira", "écran": "aesia", "app": "assa", "alerte|alertes": "naerai",
        "légende": "lyvenne", "filtre": "fyltha", "sentiers": "senthai", "processus": "vyrassa", "rocher|rochers": "ronna",
        "statut": "staela", "origine": "orinna", "arrivée": "aravae", "outils": "tessai", "son|sons": "lyss",
        "attend": "lyvae", "attendre": "lyvaen", "attente": "lyvaessa", "forge": "thaere", "lit": "lisse", "écrit": "ysre",
        "édite": "aedre", "cherche": "shaene", "lance": "lanthe", "consulte": "veyre", "dresse": "sethre", "propose": "faere",
        "demande": "vaelre", "explore": "aessre", "utilise|utiliser": "ysse", "arrive": "aravre", "reçoit": "nesse",
        "revient": "raevre", "part": "vaere", "quitte|quitté": "fyre", "repose": "ylvre", "envoie": "syndre", "porte": "fere",
        "peint": "myrre", "dessine": "lynthe", "réfléchit|réfléchissent": "saelre", "médite": "naelre", "met": "teve",
        "ajoute": "aevre", "corrige": "thorre", "active|activé|activée|activées|activer": "vyna",
        "coupé|coupée|coupées|coupés|couper": "tyssa", "installe": "estalre", "ouvrir": "aenre", "voir": "seve",
        "masquer": "vylre", "copier": "ymre", "copié": "ymrae", "choisir": "laere", "revenir": "raevren", "aller": "alle",
        "fermer": "fyrre", "allumé|allumée|allumés|allumées": "naerae", "utilisé|utilisée|utilisés|utilisées": "yssae",
        "éveille": "aelvre", "guette": "vaethe", "traque": "shaere", "nouvelle|nouveau|nouvel": "nysa", "plein|pleine": "pyrna",
        "vide": "vaena", "inconnu": "uvessa", "inactif": "lessyra", "endormi": "yssyle", "premier": "aenna",
        "secrète": "thaessa", "rouge": "rua", "vert": "verya", "jaune": "yalla", "grand": "aerya", "petit": "nysse",
        "parti|partie": "vaerae", "mot|mots": "ressi", "voix": "lirae", "monde": "aelmara"
      }
    },
    "dwarf": {
      "name": "Zgördrak",
      "gen": {
        "onsetFirst": ["dr", "gr", "tr", "br", "kr", "zg", "st", "b", "d", "g", "k", "t", "z", "gn", "bl", "sk", "str", "gr"],
        "onset": ["dr", "gr", "tr", "br", "kr", "zg", "st", "b", "d", "g", "k", "t", "z", "r", "m", "gn", "sk"],
        "nucleus": ["a", "o", "u", "ö", "ü", "ø", "a", "o", "u", "e", "i"],
        "coda": ["", "", "r", "n", "m", "g", "z", "k"],
        "codaEnd": ["rk", "rd", "zg", "gg", "rn", "st", "nd", "k", "t", "g", "rm", "rz", "mb", "dd", "rg", "kt", "rt"],
        "add": 2, "div": 4, "min": 1, "max": 3, "redouble": false
      },
      "lex": {
        "de|d'|des": "og", "le|la|l'": "dra", "les": "dro", "un|une": "gru", "à": "zu", "au|aux": "zud", "du": "ögd",
        "en": "üm", "dans": "brüm", "est": "ok", "sont": "okk", "ou": "örk", "et": "ag", "sur": "trok", "pour": "grim",
        "par": "brak", "avec": "tru", "sans": "nök", "sous": "drun", "entre": "zgeb", "vers": "tork", "depuis": "gromt",
        "encore": "ögg", "après": "drök", "quand": "kröt", "puis": "brüt", "plus": "mürk", "ne|n'": "nü", "pas": "nüt",
        "non": "nürk", "aucun|aucune": "nükt", "rien": "nögr", "qui|que|qu'": "kro", "il|elle|on": "grö", "je|j'": "mok",
        "tu|te|t'": "dok", "ta|ton|tes": "dokk", "vous": "doks", "mon|ma|mes|m'": "mokk", "sa|ses": "grök",
        "ce|cette|ces|c'|ceci": "dek", "se|s'": "zö", "y": "üd", "a|as|ai|ont": "gak", "tout|toute|toutes|tous": "alk",
        "ceux": "deks", "très": "grakk", "quelque": "stük", "quelqu'un": "stükmok", "aujourd'hui": "dagbrek",
        "nain|nains": "drokk", "magicien|magiciens|mage": "grimstrok", "elfe|elfes": "zviltra", "éclaireur|éclaireurs": "skötr",
        "artiste|artistes": "brüsk", "troll|trolls": "trögg", "hobbit|hobbits": "stumpki", "aigle": "kregg",
        "carte": "skrod", "terre|terres": "grönd", "milieu": "mözg", "compagnie|compagnies": "brokkar", "agent|agents": "drokt",
        "session|sessions": "sekt", "mission|missions": "drav", "quête": "gruvt", "réponse": "röpt", "question": "kvörk",
        "message|messages": "brekk", "chronique": "skrolk", "conseil": "gromrat", "musique": "drumgo", "langue": "tungr",
        "plan": "plönk", "test|tests": "probk", "notification|notifications": "glonk", "réglages": "skrüv",
        "limite": "grenz", "cache": "kläft", "feu|feux": "bränd", "alarme": "gnarg", "balise|balises": "stökt",
        "réserves": "hört", "jetons": "zölt", "sac|bagage": "säk", "contexte": "kröml", "fichier|fichiers": "tafl",
        "parchemin|parchemins": "skröl", "route": "steg", "jour|jours": "dagr", "nuit": "nött", "cycle": "kring",
        "mode": "möd", "démo": "skau", "page": "blad", "clic": "knök", "droit": "rekt", "appui": "drükk", "long": "lönk",
        "effets": "zrök", "ambiance": "brümt", "commande|commandes": "gromk", "code": "rünk", "entrée": "gröt",
        "sortie": "üdr", "coût": "kost", "modèle": "mödl", "dossier": "kist", "rapport": "rapt", "permission": "lövd",
        "attention": "hork", "étoiles": "glitr", "lembas": "brot", "greniers": "grönar", "royaume": "rikk",
        "repos": "rost", "brume": "dunst", "fenêtre": "fönstr", "liste": "lökt", "tâche|tâches": "trakt",
        "bataille": "bragg", "navigateur": "brögz", "écran": "skrän", "app": "apt", "alerte|alertes": "gnarger",
        "légende": "sögr", "filtre": "silt", "sentiers": "stigr", "processus": "mölk", "rocher|rochers": "strak",
        "statut": "stønd", "origine": "urk", "arrivée": "grünk", "outils": "verk", "son|sons": "brum",
        "attend": "harrk", "attendre": "harrken", "attente": "harrkung", "forge": "smörg", "lit": "glön", "écrit": "skrabb",
        "édite": "hamr", "cherche": "grubb", "lance": "slagg", "consulte": "kunz", "dresse": "drest", "propose": "probb",
        "demande": "frag", "explore": "skurr", "utilise|utiliser": "brükk", "arrive": "kumm", "reçoit": "grapp",
        "revient": "kerr", "part": "gangr", "quitte|quitté": "frok", "repose": "rösst", "envoie": "skikk", "porte": "trag",
        "peint": "smirr", "dessine": "kratz", "réfléchit|réfléchissent": "grübl", "médite": "brütt", "met": "setz",
        "ajoute": "zutr", "corrige": "fiksr", "active|activé|activée|activées|activer": "zünd",
        "coupé|coupée|coupées|coupés|couper": "kapp", "installe": "baugr", "ouvrir": "öffn", "voir": "glotz",
        "masquer": "deckr", "copier": "kopp", "copié": "koppt", "choisir": "kör", "revenir": "kerrn", "aller": "gang",
        "fermer": "zupp", "allumé|allumée|allumés|allumées": "brännt", "utilisé|utilisée|utilisés|utilisées": "brükkt",
        "éveille": "vekk", "guette": "lürk", "traque": "jagr", "nouvelle|nouveau|nouvel": "nöjk", "plein|pleine": "völl",
        "vide": "lerr", "inconnu": "ünkt", "inactif": "faul", "endormi": "snorr", "premier": "först",
        "secrète": "hemk", "rouge": "rött", "vert": "grenn", "jaune": "gölb", "grand": "gromm", "petit": "stüpp",
        "parti|partie": "gangt", "mot|mots": "wörk", "voix": "brumm", "monde": "welt"
      }
    },
    "ent": {
      "name": "Moorvaaloorooma",
      "gen": {
        "onsetFirst": ["b", "m", "l", "r", "w", "v", "n", "d", "gr", "bl", "br", "dr", "h", "", ""],
        "onset": ["b", "m", "l", "r", "w", "v", "n", "d", "gr", "bl", "br", "dr", "mb", "lm"],
        "nucleus": ["oo", "aa", "uu", "oa", "ou", "aaa", "ooo", "ua", "o", "a", "u", "oo"],
        "coda": ["", "", "", "", "m", "r", "n", "rr"],
        "codaEnd": ["m", "rm", "lm", "n", "rn", "mm", "", "", "r", "mb"],
        "add": 3, "div": 3, "min": 2, "max": 5, "redouble": true
      },
      "lex": {
        "de|d'": "vaa", "des": "vaavaa", "le|la|l'": "laa", "les": "laalaa", "un|une": "waa", "à": "uum", "au|aux": "uumlaa",
        "du": "voolaa", "en": "oombo", "dans": "oombaa", "est": "boorom", "sont": "booroom", "ou": "waala", "et": "aamaa",
        "sur": "roolom", "pour": "vooruum", "par": "baaloom", "avec": "maamoor", "sans": "nuuroo", "sous": "uuvaa",
        "entre": "aamboo", "vers": "waaroom", "depuis": "doorooloo", "encore": "oonoorooroo", "après": "baaroolum",
        "quand": "woomaa", "puis": "aamroo", "plus": "moorm", "ne|n'": "noo", "pas": "nooroo", "non": "noomoo",
        "aucun|aucune": "noorooloom", "rien": "noolaalaa", "qui|que|qu'": "woolaa", "il|elle|on": "bruu", "je|j'": "moom",
        "tu|te|t'": "doom", "ta|ton|tes": "dooma", "vous": "doomoo", "mon|ma|mes|m'": "mooma", "sa|ses": "bruumaa",
        "ce|cette|ces|c'|ceci": "daaloo", "se|s'": "vuum", "y": "aa", "a|as|ai|ont": "haaboom", "tout|toute|toutes|tous": "oolaamoo",
        "ceux": "daaloodaa", "très": "vooovoo", "quelque": "waaloo", "quelqu'un": "waaloowaa", "aujourd'hui": "daaloomnuu",
        "nain|nains": "groomboorum", "magicien|magiciens|mage": "haavaloomaa", "elfe|elfes": "liilooloo",
        "éclaireur|éclaireurs": "woovaaroom", "artiste|artistes": "maaloomaavaa", "troll|trolls": "boorgaaloom",
        "hobbit|hobbits": "booloobaa", "aigle": "waaraaroom", "carte": "laamboroo", "terre|terres": "oorlaam",
        "milieu": "maamoomoo", "compagnie|compagnies": "vaaloombaa", "agent|agents": "aagoorm", "session|sessions": "soolaamoo",
        "mission|missions": "miivooloom", "quête": "noovaaraam", "réponse": "roomaaroo", "question": "wuuroomaa",
        "message|messages": "maalaawuum", "chronique": "aaloorooloom", "conseil": "booloomaar", "musique": "moorooloo",
        "langue": "laawooroo", "plan": "baalaam", "test|tests": "toorooloo", "notification|notifications": "noowaaloom",
        "réglages": "raagooloom", "limite": "baarraam", "cache": "huudaam", "feu|feux": "fuuroom", "alarme": "aalaarum",
        "balise|balises": "baaliiloom", "réserves": "rooroovaa", "jetons": "doovoomaa", "sac|bagage": "saaboom",
        "contexte": "moovaarum", "fichier|fichiers": "laavuum", "parchemin|parchemins": "baaroomaa", "route": "roovaa",
        "jour|jours": "daaloom", "nuit": "nuuvaa", "cycle": "rooroo", "mode": "moomaa", "démo": "daamoo", "page": "baalaa",
        "clic": "toom", "droit": "raawoo", "appui": "baaroom", "long": "looomoo", "effets": "aavooloo", "ambiance": "aamboolaa",
        "commande|commandes": "goomaa", "code": "gooroom", "entrée": "inooroo", "sortie": "ooroomaa", "coût": "goolaa",
        "modèle": "moolaar", "dossier": "doolaam", "rapport": "raavoom", "permission": "laavaarum", "attention": "aawooom",
        "étoiles": "liiloolaa", "lembas": "booraam", "greniers": "graamaaboo", "royaume": "raamooloom", "repos": "ruulaam",
        "brume": "muuvaa", "fenêtre": "faawoomaa", "liste": "liilaam", "tâche|tâches": "taaroom", "bataille": "baataaloom",
        "navigateur": "naavooloom", "écran": "aakaaroom", "app": "aapoom", "alerte|alertes": "aalaarumaa",
        "légende": "laagooroom", "filtre": "fiiloom", "sentiers": "sooloom", "processus": "vooroovoo",
        "rocher|rochers": "roorooroom", "statut": "staaloom", "origine": "oorooma", "arrivée": "aaraavoo",
        "outils": "toolaamoo", "son|sons": "uumoo", "attend": "waaroolaa", "attendre": "waaroolaamaa",
        "attente": "waaroolaawaa", "forge": "graamboom", "lit": "liivoolaa", "écrit": "riiloom", "édite": "aadoolaam",
        "cherche": "suuvaaloom", "lance": "laandoom", "consulte": "voonuuloom", "dresse": "draaloom", "propose": "boroovaam",
        "demande": "maandoolaa", "explore": "aavooroom", "utilise|utiliser": "uuloom", "arrive": "aaraam",
        "reçoit": "roosoom", "revient": "roovaaroom", "part": "paawoom", "quitte|quitté": "fuulaam", "repose": "ruulaamoo",
        "envoie": "voolaaroom", "porte": "booroom", "peint": "maaloom", "dessine": "daawoolaa",
        "réfléchit|réfléchissent": "oomoorooroom", "médite": "mooliilaam", "met": "maam", "ajoute": "aavuum",
        "corrige": "rooraaloom", "active|activé|activée|activées|activer": "vaavoo",
        "coupé|coupée|coupées|coupés|couper": "guulaam", "installe": "baawooom", "ouvrir": "oovaam", "voir": "soovuum",
        "masquer": "muumaaloo", "copier": "koopoom", "copié": "koopoomoo", "choisir": "woolaam", "revenir": "roovaaroomaa",
        "aller": "aaloo", "fermer": "fuumaa", "allumé|allumée|allumés|allumées": "fuuroomaa",
        "utilisé|utilisée|utilisés|utilisées": "uuloomoo", "éveille": "aawaaloom", "guette": "guuvaaloom",
        "traque": "traavoom", "nouvelle|nouveau|nouvel": "nuuvoo", "plein|pleine": "bloomaa", "vide": "vuuvaa",
        "inconnu": "uunooroo", "inactif": "sluumaa", "endormi": "zuumoomoo", "premier": "fooroomaa", "secrète": "suuroolaa",
        "rouge": "ruumaa", "vert": "vooroomaa", "jaune": "yaaloomaa", "grand": "groooom", "petit": "biibaa",
        "parti|partie": "paawoomaa", "mot|mots": "woordoo", "voix": "hooomaa", "monde": "maaloorooma"
      }
    }
  }
}/*CONLANG-JSON-END*/;
  if (typeof module !== 'undefined' && module.exports) module.exports = DATA;
  else root.LOTRConlangData = DATA;
})(typeof window !== 'undefined' ? window : globalThis);
