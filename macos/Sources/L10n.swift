import Foundation

/// Language of the app's own strings (menu bar, menus, notifications, alerts, waiting screen).
/// Same 8 languages as the page (public/js/i18n.js). The page tells the app which language it uses
/// ({type: 'lang'} on the bridge) and the « Langue » submenu of the menu bar tells the page.
/// Remembered in UserDefaults; before the first choice, the system language (fr/en/it/es/ja), else fr.
/// Fallback key by key: language -> fr. Invented languages (elf / dwarf / ent): the French text is turned
/// into the invented language (Conlang, same algorithm and data as the page), args left untouched;
/// gloss() / tm() / tb() give the French next to it (menus, alerts). Ent: also slowed down.
enum L10n {
    struct Lang {
        let code: String
        let flag: String
        let name: String
        let locale: String
        let fantasy: Bool
        /// Name of an invented language in the language itself (empty for the real ones).
        var native: String { fantasy ? Conlang.name(code) : "" }
        /// "Elfique — Velisaine".
        var displayName: String { native.isEmpty ? name : "\(name) — \(native)" }
    }

    static let langs: [Lang] = [
        Lang(code: "fr", flag: "🇫🇷", name: "Français", locale: "fr_FR", fantasy: false),
        Lang(code: "en", flag: "🇬🇧", name: "English", locale: "en_GB", fantasy: false),
        Lang(code: "it", flag: "🇮🇹", name: "Italiano", locale: "it_IT", fantasy: false),
        Lang(code: "es", flag: "🇪🇸", name: "Español", locale: "es_ES", fantasy: false),
        Lang(code: "ja", flag: "🇯🇵", name: "日本語", locale: "ja_JP", fantasy: false),
        Lang(code: "elf", flag: "🧝", name: "Elfique", locale: "fr_FR", fantasy: true),
        Lang(code: "dwarf", flag: "⛏️", name: "Langue des nains", locale: "fr_FR", fantasy: true),
        Lang(code: "ent", flag: "🌳", name: "Langue des Ents", locale: "fr_FR", fantasy: true),
    ]
    static func isLang(_ code: String) -> Bool { langs.contains { $0.code == code } }

    private static let defaultsKey = "lang"

    /// Current language (UserDefaults, else the system language).
    static var lang: String {
        if let saved = UserDefaults.standard.string(forKey: defaultsKey), isLang(saved) { return saved }
        return systemLang()
    }

    static func systemLang() -> String {
        for id in Locale.preferredLanguages {
            let code = String(id.prefix(2)).lowercased()
            if ["fr", "en", "it", "es", "ja"].contains(code) { return code }
        }
        return "fr"
    }

    /// Remembers a language. Returns false when invalid or unchanged.
    @discardableResult
    static func set(_ code: String) -> Bool {
        guard isLang(code) else { return false }
        let changed = code != lang || UserDefaults.standard.string(forKey: defaultsKey) == nil
        UserDefaults.standard.set(code, forKey: defaultsKey)
        return changed
    }

    /// Whether a language is an invented one (and its data is available).
    static func isFantasy(_ code: String) -> Bool {
        (langs.first { $0.code == code }?.fantasy ?? false) && Conlang.has(code)
    }

    static var locale: Locale { Locale(identifier: (langs.first { $0.code == lang } ?? langs[0]).locale) }

    // MARK: - lookup

    static func t(_ key: String, _ args: [String: String] = [:]) -> String { tl(lang, key, args) }

    static func tl(_ l: String, _ key: String, _ args: [String: String] = [:]) -> String {
        var template: String
        if isFantasy(l) {
            let fr = tables["fr"]?[key] ?? key
            template = Conlang.translate(l, fr)
            if l == "ent" && template != fr { template = slowKeeping(template) }
        } else {
            template = tables[l]?[key] ?? tables["fr"]?[key] ?? key
        }
        return fill(template, args)
    }

    /// Placeholders replaced by the args, in one pass (an arg is never read as a template).
    private static func fill(_ template: String, _ args: [String: String]) -> String {
        guard !args.isEmpty, template.contains("{") else { return template }
        var out = ""
        var rest = Substring(template)
        while let open = rest.firstIndex(of: "{") {
            out += rest[..<open]
            if let close = rest[open...].firstIndex(of: "}"), let v = args[String(rest[rest.index(after: open)..<close])] {
                out += v
                rest = rest[rest.index(after: close)...]
            } else {
                out += "{"
                rest = rest[rest.index(after: open)...]
            }
        }
        return out + rest
    }

    /// Ent: slowed down, protected terms of several words (commands, product names) left whole.
    private static func slowKeeping(_ s: String) -> String {
        var marked = s
        var kept: [String] = []
        for k in Conlang.keepTerms where k.contains(" ") && marked.contains(k) {
            marked = marked.replacingOccurrences(of: k, with: "{__keep\(kept.count)}")
            kept.append(k)
        }
        var out = entify(marked)
        for (i, k) in kept.enumerated() { out = out.replacingOccurrences(of: "{__keep\(i)}", with: k) }
        return out
    }

    /// French text of a key when the current language is an invented one, else nil.
    static func gloss(_ key: String, _ args: [String: String] = [:]) -> String? {
        isFantasy(lang) ? tl("fr", key, args) : nil
    }
    /// Menu item / button title: "invented (French)" in an invented language.
    static func tm(_ key: String, _ args: [String: String] = [:]) -> String {
        let s = t(key, args)
        guard let g = gloss(key, args), g != s else { return s }
        return "\(s) (\(g))"
    }
    /// Body text (alerts): the invented text, then the French one.
    static func tb(_ key: String, _ args: [String: String] = [:]) -> String {
        let s = t(key, args)
        guard let g = gloss(key, args), g != s else { return s }
        return "\(s)\n\n\(g)"
    }

    /// "1 compagnie active" / "3 compagnies actives": key.one / key.other.
    static func plural(_ key: String, _ n: Int, _ args: [String: String] = [:]) -> String {
        var a = args
        a["n"] = number(Double(n), 0)
        let one = n == 1 || (lang != "en" && lang != "it" && lang != "es" && lang != "ja" && n == 0)
        return t(key + (one ? ".one" : ".other"), a)
    }
    /// French plural, for glosses.
    static func pluralFr(_ key: String, _ n: Int, _ args: [String: String] = [:]) -> String {
        var a = args
        a["n"] = number(Double(n), 0)
        return tl("fr", key + (n <= 1 ? ".one" : ".other"), a)
    }

    static func number(_ v: Double, _ digits: Int) -> String {
        let f = NumberFormatter()
        f.locale = locale
        f.numberStyle = .decimal
        f.minimumFractionDigits = digits
        f.maximumFractionDigits = digits
        return f.string(from: NSNumber(value: v)) ?? String(v)
    }

    /// Ent: "Le serveur démarre sur le port 4777" -> "Hrrm… le… serveur… démarre… sur… le… port… {port}…".
    /// Short labels (3 words or less: menu items, buttons) stay as they are.
    static func entify(_ s: String) -> String {
        let words = s.split(whereSeparator: { $0 == " " || $0 == "\n" }).map(String.init)
        guard words.count > 3 else { return s }
        var out: [String] = []
        for (i, w0) in words.enumerated() {
            var w = w0
            if let last = out.last, w.allSatisfy({ ":;!?»%.,…".contains($0) }) {
                out[out.count - 1] = String(last.hasSuffix("…") ? last.dropLast() : Substring(last)) + " " + w + (w.hasSuffix(".") || w.hasSuffix("!") || w.hasSuffix("?") ? "" : "…")
                continue
            }
            if i == 0, let f = w.first, f.isUppercase, w.count > 1, w.dropFirst().first?.isLowercase == true {
                w = f.lowercased() + w.dropFirst()
            }
            out.append(w.hasSuffix("…") || w.hasSuffix(".") || w.hasSuffix("!") || w.hasSuffix("?") ? w : w + "…")
        }
        return "Hrrm… " + out.joined(separator: " ")
    }

    // MARK: - tables

    static let tables: [String: [String: String]] = ["fr": fr, "en": en, "it": it, "es": es, "ja": ja]

    static let fr: [String: String] = [
        "app.name": "Terre du Milieu",
        "menu.language": "Langue",
        "menu.companies.one": "{n} compagnie active",
        "menu.companies.other": "{n} compagnies actives",
        "menu.summary": "{companies} · {coding} codent · {waiting} en attente",
        "menu.waitingHeader": "En attente de ta réponse",
        "menu.company": "Compagnie",
        "menu.demoTag": " (démo)",
        "menu.five": "Lembas (5 h)",
        "menu.seven": "Greniers (7 j)",
        "menu.limitRefilled": "{name} : réserves reconstituées",
        "menu.limitLine": "{name} : {pct} %",
        "menu.limitReset": " — reset dans {left}",
        "menu.limitsPending": "Limites : en attente de la status line",
        "menu.limitsHint": "Les limites 5 h / 7 jours n'apparaissent qu'avec une session Claude Code lancée dans un terminal (status line). Jetons du jour : d'après les transcripts.",
        "menu.tokensToday": "Jetons du jour : {n}",
        "menu.unreachable": "Serveur de la carte injoignable",
        "menu.openMap": "Ouvrir la carte",
        "menu.demo": "Mode démo",
        "menu.openBrowser": "Ouvrir dans le navigateur",
        "menu.testNotif": "Tester les notifications",
        "menu.chooseMusic": "Choisir ta musique…",
        "menu.yourMusic": "Ta musique : {name}",
        "menu.resetMusic": "Revenir à la musique générée",
        "menu.installHooks": "Installer les hooks Claude Code…",
        "menu.uninstallHooks": "Désinstaller les hooks Claude Code…",
        "menu.quit": "Quitter Terre du Milieu",
        "server.external": "Serveur existant sur le port {port}",
        "server.embedded": "Serveur intégré sur le port {port}",
        "server.failed": "Serveur indisponible",
        "server.crashed": "Le serveur s'est arrêté plusieurs fois. Consulte {path}.",
        "server.noNode": "Node.js est introuvable.",
        "server.launchFailed": "Impossible de lancer Node : {error}",
        "server.musicExternal": "La carte utilise un serveur déjà lancé sur le port {port} (par exemple npm start) : ta musique ne peut être servie que par le serveur intégré de l'app. Arrête ce serveur puis relance l'app.",
        "server.musicUnreadable": "Ce fichier n'est pas lisible comme musique (formats : mp3, m4a, aac, wav, aiff).",
        "server.musicRefused": "Le serveur de la carte n'a pas accepté la musique ({error}).",
        "notif.waitTitle": "🔥 {project} attend ta réponse",
        "notif.someCompany": "Une compagnie",
        "notif.fires": "Les feux d'alarme sont allumés.",
        "notif.limit95": "⚠️ Les lembas sont presque épuisés",
        "notif.limit80": "⚠️ Les lembas s'épuisent",
        "notif.limitBody": "{pct} % de la limite d'usage de Claude sur 5 h.",
        "notif.resetIn": " Reset dans {left}.",
        "notif.testTitle": "🔥 Test — les feux d'alarme fonctionnent",
        "notif.testBody": "Tu seras prévenu ici quand un agent attend ta réponse.",
        "wait.permission": "Demande la permission d'utiliser {tool}",
        "wait.input": "Attend ta réponse",
        "wait.attention": "Réclame ton attention",
        "wait.plan": "Plan à approuver",
        "dur.s": "{n} s",
        "dur.m": "{n} min",
        "dur.hm": "{h} h {mm}",
        "dur.dh": "{d} j {h} h",
        "fmt.k": "{n} k",
        "fmt.M": "{n} M",
        "fmt.G": "{n} G",
        "fmt.usd": "{n} $",
        "alert.ok": "OK",
        "alert.deniedTitle": "Notifications refusées",
        "alert.deniedText": "macOS bloque les notifications de Terre du Milieu. Dans Réglages Système > Notifications (qui viennent de s'ouvrir), choisis Terre du Milieu et active « Autoriser les notifications ».",
        "alert.notAuthTitle": "Notifications non autorisées",
        "alert.notAuthText": "L'autorisation n'a pas été accordée (état : {state}). Réessaie depuis ce menu.",
        "alert.nodeTitle": "Node.js est introuvable",
        "alert.nodeText": "La carte a besoin de Node.js (version 18 ou plus) pour faire tourner son serveur local.\nEmplacements cherchés : /opt/homebrew/bin/node, /usr/local/bin/node, ~/.nvm/versions/node/*/bin/node, puis « command -v node » dans un shell de connexion zsh.\nInstalle Node (par exemple « brew install node » ou nvm), puis relance l'app.",
        "alert.nodeOpen": "Ouvrir nodejs.org",
        "hooks.installQ": "Installer les hooks Claude Code ?",
        "hooks.uninstallQ": "Désinstaller les hooks Claude Code ?",
        "hooks.installText": "Les hooks de la carte vont être ajoutés à {settings} (tes autres réglages et hooks sont conservés, sauvegarde dans settings.json.bak-lotr).\n\nScript utilisé : {script}",
        "hooks.uninstallText": "Les hooks de la carte vont être retirés de {settings} (sauvegarde dans settings.json.bak-lotr). Tes autres hooks sont conservés.",
        "hooks.install": "Installer",
        "hooks.uninstall": "Désinstaller",
        "hooks.cancel": "Annuler",
        "hooks.installed": "Hooks installés",
        "hooks.uninstalled": "Hooks désinstallés",
        "hooks.failed": "Échec",
        "hooks.relaunch": "Relance tes sessions Claude Code (ou /hooks) pour les activer.",
        "music.errorTitle": "Impossible d'utiliser cette musique",
        "music.panelTitle": "Choisir ta musique",
        "music.panelMessage": "Le fichier reste à sa place : la carte ne mémorise que son emplacement.",
        "music.panelPrompt": "Choisir",
        "main.about": "À propos de Terre du Milieu",
        "main.hide": "Masquer Terre du Milieu",
        "main.hideOthers": "Masquer les autres",
        "main.edit": "Édition",
        "main.copy": "Copier",
        "main.paste": "Coller",
        "main.selectAll": "Tout sélectionner",
        "main.view": "Présentation",
        "main.fullScreen": "Plein écran",
        "main.reload": "Recharger",
        "main.window": "Fenêtre",
        "main.close": "Fermer",
        "main.minimize": "Réduire",
        "main.map": "Carte",
        "waiting.title": "La carte se déploie…",
        "waiting.starting": "Le serveur de la carte démarre sur le port {port}…",
        "waiting.retry": "Nouvelle tentative chaque seconde.",
        "focus.menuSessions": "Sessions",
        "focus.menuNoSession": "Aucune session active",
        "focus.menuSettings": "Aller aux sessions",
        "focus.menuDesktopHeader": "Sessions de l'app Claude (bureau) :",
        "focus.menuDesktopLink": "Lien direct vers la session",
        "focus.menuDesktopApp": "Juste ouvrir Claude",
        "focus.menuNotifHeader": "Clic sur une notification « attend ta réponse » :",
        "focus.menuNotifSession": "Aller à la session",
        "focus.menuNotifMap": "Ouvrir la carte",
        "focus.menuWaitingTip": "Clique pour aller à cette session",
        "focus.ok": "OK",
        "focus.cancel": "Annuler",
        "focus.resume": "Reprendre",
        "focus.openMap": "Ouvrir la carte",
        "focus.goneTitle": "Session introuvable",
        "focus.goneText": "Cet agent n'est plus sur la carte.",
        "focus.demoTitle": "Session de démonstration",
        "focus.demoText": "Les compagnies du mode démo n'ont pas de vraie session Claude Code.",
        "focus.noOriginTitle": "Origine de la session inconnue",
        "focus.noOriginText": "La carte ne sait pas où tourne cette session : elle a été vue avant la mise à jour des hooks, ou son terminal n'est pas reconnu. Elle le saura au prochain événement de la session.",
        "focus.unknownApp": "Cette session tourne dans « {what} », que la carte ne sait pas mettre au premier plan. Ouvre-la à la main.",
        "focus.resumeTitle": "Reprendre cette session ?",
        "focus.resumeEnded": "La session de {project} est terminée. La reprendre dans une nouvelle fenêtre du Terminal (claude --resume) ?",
        "focus.resumeTabMissing": "Aucun onglet de {app} ne correspond à la session de {project} (fermé ?). La reprendre dans une nouvelle fenêtre du Terminal (claude --resume) ?",
        "focus.resumeNoId": "L'identifiant de cette session n'est pas valide : impossible de la reprendre automatiquement.",
        "focus.automationTitle": "Autorisation nécessaire",
        "focus.automationText": "macOS empêche Terre du Milieu de piloter {app}. Dans Réglages Système > Confidentialité et sécurité > Automatisation, autorise Terre du Milieu à contrôler {app}, puis réessaie.",
        "focus.scriptFailedTitle": "Impossible d'aller à la session",
        "focus.appMissingTitle": "Application introuvable",
        "focus.appMissingText": "{name} n'est pas installée sur ce Mac.",
        "focus.thisCompany": "cette compagnie",
    ]

    static let en: [String: String] = [
        "app.name": "Middle-earth",
        "menu.language": "Language",
        "menu.companies.one": "{n} active company",
        "menu.companies.other": "{n} active companies",
        "menu.summary": "{companies} · {coding} coding · {waiting} waiting",
        "menu.waitingHeader": "Waiting for your answer",
        "menu.company": "Company",
        "menu.demoTag": " (demo)",
        "menu.five": "Lembas (5 h)",
        "menu.seven": "Granaries (7 d)",
        "menu.limitRefilled": "{name}: supplies restored",
        "menu.limitLine": "{name}: {pct}%",
        "menu.limitReset": " — resets in {left}",
        "menu.limitsPending": "Limits: waiting for the status line",
        "menu.limitsHint": "The 5 h / 7 day limits only show up with a Claude Code session running in a terminal (status line). Today's tokens: from the transcripts.",
        "menu.tokensToday": "Tokens today: {n}",
        "menu.unreachable": "Map server unreachable",
        "menu.openMap": "Open the map",
        "menu.demo": "Demo mode",
        "menu.openBrowser": "Open in the browser",
        "menu.testNotif": "Test notifications",
        "menu.chooseMusic": "Choose your music…",
        "menu.yourMusic": "Your music: {name}",
        "menu.resetMusic": "Back to the generated music",
        "menu.installHooks": "Install the Claude Code hooks…",
        "menu.uninstallHooks": "Uninstall the Claude Code hooks…",
        "menu.quit": "Quit Terre du Milieu",
        "server.external": "Existing server on port {port}",
        "server.embedded": "Built-in server on port {port}",
        "server.failed": "Server unavailable",
        "server.crashed": "The server stopped several times. See {path}.",
        "server.noNode": "Node.js cannot be found.",
        "server.launchFailed": "Cannot start Node: {error}",
        "server.musicExternal": "The map uses a server already running on port {port} (npm start, for instance): your music can only be served by the app's built-in server. Stop that server, then relaunch the app.",
        "server.musicUnreadable": "This file cannot be played as music (formats: mp3, m4a, aac, wav, aiff).",
        "server.musicRefused": "The map server did not accept the music ({error}).",
        "notif.waitTitle": "🔥 {project} is waiting for your answer",
        "notif.someCompany": "A company",
        "notif.fires": "The beacons are lit.",
        "notif.limit95": "⚠️ The lembas are almost gone",
        "notif.limit80": "⚠️ The lembas are running low",
        "notif.limitBody": "{pct}% of Claude's 5-hour usage limit.",
        "notif.resetIn": " Resets in {left}.",
        "notif.testTitle": "🔥 Test — the beacons are working",
        "notif.testBody": "You will be told here when an agent waits for your answer.",
        "wait.permission": "Asks permission to use {tool}",
        "wait.input": "Waiting for your answer",
        "wait.attention": "Needs your attention",
        "wait.plan": "Plan to approve",
        "dur.s": "{n}s",
        "dur.m": "{n} min",
        "dur.hm": "{h}h {mm}",
        "dur.dh": "{d}d {h}h",
        "fmt.k": "{n}k",
        "fmt.M": "{n}M",
        "fmt.G": "{n}G",
        "fmt.usd": "${n}",
        "alert.ok": "OK",
        "alert.deniedTitle": "Notifications blocked",
        "alert.deniedText": "macOS blocks the notifications of Terre du Milieu. In System Settings > Notifications (just opened), choose Terre du Milieu and turn on “Allow notifications”.",
        "alert.notAuthTitle": "Notifications not allowed",
        "alert.notAuthText": "Permission was not granted (state: {state}). Try again from this menu.",
        "alert.nodeTitle": "Node.js cannot be found",
        "alert.nodeText": "The map needs Node.js (version 18 or later) to run its local server.\nPlaces searched: /opt/homebrew/bin/node, /usr/local/bin/node, ~/.nvm/versions/node/*/bin/node, then “command -v node” in a zsh login shell.\nInstall Node (with “brew install node” or nvm, for instance), then relaunch the app.",
        "alert.nodeOpen": "Open nodejs.org",
        "hooks.installQ": "Install the Claude Code hooks?",
        "hooks.uninstallQ": "Uninstall the Claude Code hooks?",
        "hooks.installText": "The map's hooks will be added to {settings} (your other settings and hooks are kept, backup in settings.json.bak-lotr).\n\nScript used: {script}",
        "hooks.uninstallText": "The map's hooks will be removed from {settings} (backup in settings.json.bak-lotr). Your other hooks are kept.",
        "hooks.install": "Install",
        "hooks.uninstall": "Uninstall",
        "hooks.cancel": "Cancel",
        "hooks.installed": "Hooks installed",
        "hooks.uninstalled": "Hooks uninstalled",
        "hooks.failed": "Failed",
        "hooks.relaunch": "Restart your Claude Code sessions (or /hooks) to turn them on.",
        "music.errorTitle": "Cannot use this music",
        "music.panelTitle": "Choose your music",
        "music.panelMessage": "The file stays where it is: the map only remembers its location.",
        "music.panelPrompt": "Choose",
        "main.about": "About Terre du Milieu",
        "main.hide": "Hide Terre du Milieu",
        "main.hideOthers": "Hide Others",
        "main.edit": "Edit",
        "main.copy": "Copy",
        "main.paste": "Paste",
        "main.selectAll": "Select All",
        "main.view": "View",
        "main.fullScreen": "Full Screen",
        "main.reload": "Reload",
        "main.window": "Window",
        "main.close": "Close",
        "main.minimize": "Minimize",
        "main.map": "Map",
        "waiting.title": "The map is unfolding…",
        "waiting.starting": "The map server is starting on port {port}…",
        "waiting.retry": "Trying again every second.",
        "focus.menuSessions": "Sessions",
        "focus.menuNoSession": "No active session",
        "focus.menuSettings": "Going to sessions",
        "focus.menuDesktopHeader": "Sessions of the Claude app (desktop):",
        "focus.menuDesktopLink": "Direct link to the session",
        "focus.menuDesktopApp": "Just open Claude",
        "focus.menuNotifHeader": "Click on a “waiting for your answer” notification:",
        "focus.menuNotifSession": "Go to the session",
        "focus.menuNotifMap": "Open the map",
        "focus.menuWaitingTip": "Click to go to this session",
        "focus.ok": "OK",
        "focus.cancel": "Cancel",
        "focus.resume": "Resume",
        "focus.openMap": "Open the map",
        "focus.goneTitle": "Session not found",
        "focus.goneText": "This agent is no longer on the map.",
        "focus.demoTitle": "Demo session",
        "focus.demoText": "The companies of the demo mode have no real Claude Code session.",
        "focus.noOriginTitle": "Unknown session origin",
        "focus.noOriginText": "The map does not know where this session runs: it was seen before the hooks were updated, or its terminal is not recognized. It will know at the session's next event.",
        "focus.unknownApp": "This session runs in “{what}”, which the map cannot bring to the front. Open it by hand.",
        "focus.resumeTitle": "Resume this session?",
        "focus.resumeEnded": "The session of {project} has ended. Resume it in a new Terminal window (claude --resume)?",
        "focus.resumeTabMissing": "No {app} tab matches the session of {project} (closed?). Resume it in a new Terminal window (claude --resume)?",
        "focus.resumeNoId": "This session id is not valid: it cannot be resumed automatically.",
        "focus.automationTitle": "Permission needed",
        "focus.automationText": "macOS prevents Terre du Milieu from controlling {app}. In System Settings > Privacy & Security > Automation, allow Terre du Milieu to control {app}, then try again.",
        "focus.scriptFailedTitle": "Cannot go to the session",
        "focus.appMissingTitle": "Application not found",
        "focus.appMissingText": "{name} is not installed on this Mac.",
        "focus.thisCompany": "this company",
    ]

    static let it: [String: String] = [
        "app.name": "Terra di Mezzo",
        "menu.language": "Lingua",
        "menu.companies.one": "{n} compagnia attiva",
        "menu.companies.other": "{n} compagnie attive",
        "menu.summary": "{companies} · {coding} programmano · {waiting} in attesa",
        "menu.waitingHeader": "In attesa della tua risposta",
        "menu.company": "Compagnia",
        "menu.demoTag": " (demo)",
        "menu.five": "Lembas (5 h)",
        "menu.seven": "Granai (7 g)",
        "menu.limitRefilled": "{name}: scorte ripristinate",
        "menu.limitLine": "{name}: {pct}%",
        "menu.limitReset": " — reset tra {left}",
        "menu.limitsPending": "Limiti: in attesa della status line",
        "menu.limitsHint": "I limiti 5 h / 7 giorni compaiono solo con una sessione Claude Code avviata in un terminale (status line). Token di oggi: dai transcript.",
        "menu.tokensToday": "Token di oggi: {n}",
        "menu.unreachable": "Server della mappa irraggiungibile",
        "menu.openMap": "Apri la mappa",
        "menu.demo": "Modalità demo",
        "menu.openBrowser": "Apri nel browser",
        "menu.testNotif": "Prova le notifiche",
        "menu.chooseMusic": "Scegli la tua musica…",
        "menu.yourMusic": "La tua musica: {name}",
        "menu.resetMusic": "Torna alla musica generata",
        "menu.installHooks": "Installa gli hook di Claude Code…",
        "menu.uninstallHooks": "Disinstalla gli hook di Claude Code…",
        "menu.quit": "Esci da Terre du Milieu",
        "server.external": "Server esistente sulla porta {port}",
        "server.embedded": "Server integrato sulla porta {port}",
        "server.failed": "Server non disponibile",
        "server.crashed": "Il server si è fermato più volte. Consulta {path}.",
        "server.noNode": "Node.js non trovato.",
        "server.launchFailed": "Impossibile avviare Node: {error}",
        "server.musicExternal": "La mappa usa un server già avviato sulla porta {port} (per esempio npm start): la tua musica può essere servita solo dal server integrato dell’app. Ferma quel server, poi riavvia l’app.",
        "server.musicUnreadable": "Questo file non è leggibile come musica (formati: mp3, m4a, aac, wav, aiff).",
        "server.musicRefused": "Il server della mappa non ha accettato la musica ({error}).",
        "notif.waitTitle": "🔥 {project} aspetta la tua risposta",
        "notif.someCompany": "Una compagnia",
        "notif.fires": "I fuochi d’allarme sono accesi.",
        "notif.limit95": "⚠️ I lembas sono quasi finiti",
        "notif.limit80": "⚠️ I lembas scarseggiano",
        "notif.limitBody": "{pct}% del limite d’uso di Claude su 5 ore.",
        "notif.resetIn": " Reset tra {left}.",
        "notif.testTitle": "🔥 Prova — i fuochi d’allarme funzionano",
        "notif.testBody": "Sarai avvisato qui quando un agente aspetta la tua risposta.",
        "wait.permission": "Chiede il permesso di usare {tool}",
        "wait.input": "Aspetta la tua risposta",
        "wait.attention": "Reclama la tua attenzione",
        "wait.plan": "Piano da approvare",
        "dur.s": "{n} s",
        "dur.m": "{n} min",
        "dur.hm": "{h} h {mm}",
        "dur.dh": "{d} g {h} h",
        "fmt.k": "{n} k",
        "fmt.M": "{n} M",
        "fmt.G": "{n} G",
        "fmt.usd": "{n} $",
        "alert.ok": "OK",
        "alert.deniedTitle": "Notifiche bloccate",
        "alert.deniedText": "macOS blocca le notifiche di Terre du Milieu. In Impostazioni di Sistema > Notifiche (appena aperte), scegli Terre du Milieu e attiva «Consenti notifiche».",
        "alert.notAuthTitle": "Notifiche non autorizzate",
        "alert.notAuthText": "L’autorizzazione non è stata concessa (stato: {state}). Riprova da questo menu.",
        "alert.nodeTitle": "Node.js non trovato",
        "alert.nodeText": "La mappa ha bisogno di Node.js (versione 18 o successiva) per far girare il suo server locale.\nPercorsi cercati: /opt/homebrew/bin/node, /usr/local/bin/node, ~/.nvm/versions/node/*/bin/node, poi «command -v node» in una shell di login zsh.\nInstalla Node (per esempio con «brew install node» o nvm), poi riavvia l’app.",
        "alert.nodeOpen": "Apri nodejs.org",
        "hooks.installQ": "Installare gli hook di Claude Code?",
        "hooks.uninstallQ": "Disinstallare gli hook di Claude Code?",
        "hooks.installText": "Gli hook della mappa saranno aggiunti a {settings} (le altre impostazioni e gli altri hook restano, backup in settings.json.bak-lotr).\n\nScript usato: {script}",
        "hooks.uninstallText": "Gli hook della mappa saranno rimossi da {settings} (backup in settings.json.bak-lotr). Gli altri hook restano.",
        "hooks.install": "Installa",
        "hooks.uninstall": "Disinstalla",
        "hooks.cancel": "Annulla",
        "hooks.installed": "Hook installati",
        "hooks.uninstalled": "Hook disinstallati",
        "hooks.failed": "Errore",
        "hooks.relaunch": "Riavvia le sessioni di Claude Code (o /hooks) per attivarli.",
        "music.errorTitle": "Impossibile usare questa musica",
        "music.panelTitle": "Scegli la tua musica",
        "music.panelMessage": "Il file resta dov’è: la mappa ne ricorda solo la posizione.",
        "music.panelPrompt": "Scegli",
        "main.about": "Informazioni su Terre du Milieu",
        "main.hide": "Nascondi Terre du Milieu",
        "main.hideOthers": "Nascondi altre",
        "main.edit": "Modifica",
        "main.copy": "Copia",
        "main.paste": "Incolla",
        "main.selectAll": "Seleziona tutto",
        "main.view": "Vista",
        "main.fullScreen": "Schermo intero",
        "main.reload": "Ricarica",
        "main.window": "Finestra",
        "main.close": "Chiudi",
        "main.minimize": "Contrai",
        "main.map": "Mappa",
        "waiting.title": "La mappa si dispiega…",
        "waiting.starting": "Il server della mappa si avvia sulla porta {port}…",
        "waiting.retry": "Nuovo tentativo ogni secondo.",
        "focus.menuSessions": "Sessioni",
        "focus.menuNoSession": "Nessuna sessione attiva",
        "focus.menuSettings": "Andare alle sessioni",
        "focus.menuDesktopHeader": "Sessioni dell’app Claude (desktop):",
        "focus.menuDesktopLink": "Link diretto alla sessione",
        "focus.menuDesktopApp": "Apri solo Claude",
        "focus.menuNotifHeader": "Clic su una notifica «aspetta la tua risposta»:",
        "focus.menuNotifSession": "Vai alla sessione",
        "focus.menuNotifMap": "Apri la mappa",
        "focus.menuWaitingTip": "Clicca per andare a questa sessione",
        "focus.ok": "OK",
        "focus.cancel": "Annulla",
        "focus.resume": "Riprendi",
        "focus.openMap": "Apri la mappa",
        "focus.goneTitle": "Sessione non trovata",
        "focus.goneText": "Questo agente non è più sulla mappa.",
        "focus.demoTitle": "Sessione dimostrativa",
        "focus.demoText": "Le compagnie della modalità demo non hanno una vera sessione di Claude Code.",
        "focus.noOriginTitle": "Origine della sessione sconosciuta",
        "focus.noOriginText": "La mappa non sa dove gira questa sessione: è stata vista prima dell’aggiornamento degli hook, oppure il suo terminale non è riconosciuto. Lo saprà al prossimo evento della sessione.",
        "focus.unknownApp": "Questa sessione gira in «{what}», che la mappa non sa portare in primo piano. Aprila a mano.",
        "focus.resumeTitle": "Riprendere questa sessione?",
        "focus.resumeEnded": "La sessione di {project} è terminata. Riprenderla in una nuova finestra del Terminale (claude --resume)?",
        "focus.resumeTabMissing": "Nessuna scheda di {app} corrisponde alla sessione di {project} (chiusa?). Riprenderla in una nuova finestra del Terminale (claude --resume)?",
        "focus.resumeNoId": "L’identificativo di questa sessione non è valido: impossibile riprenderla automaticamente.",
        "focus.automationTitle": "Autorizzazione necessaria",
        "focus.automationText": "macOS impedisce a Terre du Milieu di controllare {app}. In Impostazioni di Sistema > Privacy e sicurezza > Automazione, consenti a Terre du Milieu di controllare {app}, poi riprova.",
        "focus.scriptFailedTitle": "Impossibile andare alla sessione",
        "focus.appMissingTitle": "Applicazione non trovata",
        "focus.appMissingText": "{name} non è installata su questo Mac.",
        "focus.thisCompany": "questa compagnia",
    ]

    static let es: [String: String] = [
        "app.name": "Tierra Media",
        "menu.language": "Idioma",
        "menu.companies.one": "{n} compañía activa",
        "menu.companies.other": "{n} compañías activas",
        "menu.summary": "{companies} · {coding} programan · {waiting} en espera",
        "menu.waitingHeader": "Esperando tu respuesta",
        "menu.company": "Compañía",
        "menu.demoTag": " (demo)",
        "menu.five": "Lembas (5 h)",
        "menu.seven": "Graneros (7 d)",
        "menu.limitRefilled": "{name}: reservas repuestas",
        "menu.limitLine": "{name}: {pct} %",
        "menu.limitReset": " — se reinicia en {left}",
        "menu.limitsPending": "Límites: esperando la status line",
        "menu.limitsHint": "Los límites de 5 h / 7 días solo aparecen con una sesión de Claude Code abierta en un terminal (status line). Tokens de hoy: según los transcripts.",
        "menu.tokensToday": "Tokens de hoy: {n}",
        "menu.unreachable": "Servidor del mapa inaccesible",
        "menu.openMap": "Abrir el mapa",
        "menu.demo": "Modo demo",
        "menu.openBrowser": "Abrir en el navegador",
        "menu.testNotif": "Probar las notificaciones",
        "menu.chooseMusic": "Elegir tu música…",
        "menu.yourMusic": "Tu música: {name}",
        "menu.resetMusic": "Volver a la música generada",
        "menu.installHooks": "Instalar los hooks de Claude Code…",
        "menu.uninstallHooks": "Desinstalar los hooks de Claude Code…",
        "menu.quit": "Salir de Terre du Milieu",
        "server.external": "Servidor existente en el puerto {port}",
        "server.embedded": "Servidor integrado en el puerto {port}",
        "server.failed": "Servidor no disponible",
        "server.crashed": "El servidor se ha detenido varias veces. Consulta {path}.",
        "server.noNode": "No se encuentra Node.js.",
        "server.launchFailed": "No se puede iniciar Node: {error}",
        "server.musicExternal": "El mapa usa un servidor ya iniciado en el puerto {port} (por ejemplo npm start): tu música solo puede servirla el servidor integrado de la app. Detén ese servidor y vuelve a abrir la app.",
        "server.musicUnreadable": "Este archivo no se puede reproducir como música (formatos: mp3, m4a, aac, wav, aiff).",
        "server.musicRefused": "El servidor del mapa no ha aceptado la música ({error}).",
        "notif.waitTitle": "🔥 {project} espera tu respuesta",
        "notif.someCompany": "Una compañía",
        "notif.fires": "Las almenaras están encendidas.",
        "notif.limit95": "⚠️ Casi no queda lembas",
        "notif.limit80": "⚠️ El lembas escasea",
        "notif.limitBody": "{pct} % del límite de uso de Claude en 5 h.",
        "notif.resetIn": " Se reinicia en {left}.",
        "notif.testTitle": "🔥 Prueba — las almenaras funcionan",
        "notif.testBody": "Se te avisará aquí cuando un agente espere tu respuesta.",
        "wait.permission": "Pide permiso para usar {tool}",
        "wait.input": "Espera tu respuesta",
        "wait.attention": "Reclama tu atención",
        "wait.plan": "Plan por aprobar",
        "dur.s": "{n} s",
        "dur.m": "{n} min",
        "dur.hm": "{h} h {mm}",
        "dur.dh": "{d} d {h} h",
        "fmt.k": "{n} k",
        "fmt.M": "{n} M",
        "fmt.G": "{n} G",
        "fmt.usd": "{n} $",
        "alert.ok": "OK",
        "alert.deniedTitle": "Notificaciones bloqueadas",
        "alert.deniedText": "macOS bloquea las notificaciones de Terre du Milieu. En Ajustes del Sistema > Notificaciones (recién abiertos), elige Terre du Milieu y activa «Permitir notificaciones».",
        "alert.notAuthTitle": "Notificaciones no autorizadas",
        "alert.notAuthText": "No se concedió el permiso (estado: {state}). Vuelve a intentarlo desde este menú.",
        "alert.nodeTitle": "No se encuentra Node.js",
        "alert.nodeText": "El mapa necesita Node.js (versión 18 o superior) para ejecutar su servidor local.\nRutas buscadas: /opt/homebrew/bin/node, /usr/local/bin/node, ~/.nvm/versions/node/*/bin/node, y luego «command -v node» en una shell de inicio de sesión zsh.\nInstala Node (por ejemplo con «brew install node» o nvm) y vuelve a abrir la app.",
        "alert.nodeOpen": "Abrir nodejs.org",
        "hooks.installQ": "¿Instalar los hooks de Claude Code?",
        "hooks.uninstallQ": "¿Desinstalar los hooks de Claude Code?",
        "hooks.installText": "Los hooks del mapa se añadirán a {settings} (tus otros ajustes y hooks se conservan, copia de seguridad en settings.json.bak-lotr).\n\nScript usado: {script}",
        "hooks.uninstallText": "Los hooks del mapa se quitarán de {settings} (copia de seguridad en settings.json.bak-lotr). Tus otros hooks se conservan.",
        "hooks.install": "Instalar",
        "hooks.uninstall": "Desinstalar",
        "hooks.cancel": "Cancelar",
        "hooks.installed": "Hooks instalados",
        "hooks.uninstalled": "Hooks desinstalados",
        "hooks.failed": "Error",
        "hooks.relaunch": "Reinicia tus sesiones de Claude Code (o /hooks) para activarlos.",
        "music.errorTitle": "No se puede usar esta música",
        "music.panelTitle": "Elegir tu música",
        "music.panelMessage": "El archivo se queda donde está: el mapa solo recuerda su ubicación.",
        "music.panelPrompt": "Elegir",
        "main.about": "Acerca de Terre du Milieu",
        "main.hide": "Ocultar Terre du Milieu",
        "main.hideOthers": "Ocultar otros",
        "main.edit": "Edición",
        "main.copy": "Copiar",
        "main.paste": "Pegar",
        "main.selectAll": "Seleccionar todo",
        "main.view": "Visualización",
        "main.fullScreen": "Pantalla completa",
        "main.reload": "Recargar",
        "main.window": "Ventana",
        "main.close": "Cerrar",
        "main.minimize": "Minimizar",
        "main.map": "Mapa",
        "waiting.title": "El mapa se despliega…",
        "waiting.starting": "El servidor del mapa se inicia en el puerto {port}…",
        "waiting.retry": "Nuevo intento cada segundo.",
        "focus.menuSessions": "Sesiones",
        "focus.menuNoSession": "Ninguna sesión activa",
        "focus.menuSettings": "Ir a las sesiones",
        "focus.menuDesktopHeader": "Sesiones de la app Claude (escritorio):",
        "focus.menuDesktopLink": "Enlace directo a la sesión",
        "focus.menuDesktopApp": "Solo abrir Claude",
        "focus.menuNotifHeader": "Clic en una notificación «espera tu respuesta»:",
        "focus.menuNotifSession": "Ir a la sesión",
        "focus.menuNotifMap": "Abrir el mapa",
        "focus.menuWaitingTip": "Haz clic para ir a esta sesión",
        "focus.ok": "OK",
        "focus.cancel": "Cancelar",
        "focus.resume": "Reanudar",
        "focus.openMap": "Abrir el mapa",
        "focus.goneTitle": "Sesión no encontrada",
        "focus.goneText": "Este agente ya no está en el mapa.",
        "focus.demoTitle": "Sesión de demostración",
        "focus.demoText": "Las compañías del modo demo no tienen una sesión real de Claude Code.",
        "focus.noOriginTitle": "Origen de la sesión desconocido",
        "focus.noOriginText": "El mapa no sabe dónde se ejecuta esta sesión: se vio antes de actualizar los hooks o su terminal no se reconoce. Lo sabrá en el próximo evento de la sesión.",
        "focus.unknownApp": "Esta sesión se ejecuta en «{what}», que el mapa no sabe traer al frente. Ábrela a mano.",
        "focus.resumeTitle": "¿Reanudar esta sesión?",
        "focus.resumeEnded": "La sesión de {project} ha terminado. ¿Reanudarla en una nueva ventana del Terminal (claude --resume)?",
        "focus.resumeTabMissing": "Ninguna pestaña de {app} corresponde a la sesión de {project} (¿cerrada?). ¿Reanudarla en una nueva ventana del Terminal (claude --resume)?",
        "focus.resumeNoId": "El identificador de esta sesión no es válido: no se puede reanudar automáticamente.",
        "focus.automationTitle": "Se necesita permiso",
        "focus.automationText": "macOS impide que Terre du Milieu controle {app}. En Ajustes del Sistema > Privacidad y seguridad > Automatización, permite que Terre du Milieu controle {app} y vuelve a intentarlo.",
        "focus.scriptFailedTitle": "No se puede ir a la sesión",
        "focus.appMissingTitle": "Aplicación no encontrada",
        "focus.appMissingText": "{name} no está instalada en este Mac.",
        "focus.thisCompany": "esta compañía",
    ]

    static let ja: [String: String] = [
        "app.name": "中つ国",
        "menu.language": "言語",
        "menu.companies.one": "稼働中の一行 {n}",
        "menu.companies.other": "稼働中の一行 {n}",
        "menu.summary": "{companies}・コーディング中 {coding}・返事待ち {waiting}",
        "menu.waitingHeader": "あなたの返事を待っています",
        "menu.company": "一行",
        "menu.demoTag": "（デモ）",
        "menu.five": "レンバス（5時間）",
        "menu.seven": "穀物庫（7日間）",
        "menu.limitRefilled": "{name}：備蓄は回復済み",
        "menu.limitLine": "{name}：{pct}%",
        "menu.limitReset": " — {left}後にリセット",
        "menu.limitsPending": "上限：ステータスラインを待っています",
        "menu.limitsHint": "5時間／7日間の上限は、ターミナルで動くClaude Codeセッション（status line）があるときだけ表示されます。本日のトークン：トランスクリプトより。",
        "menu.tokensToday": "本日のトークン：{n}",
        "menu.unreachable": "地図のサーバーに接続できません",
        "menu.openMap": "地図を開く",
        "menu.demo": "デモモード",
        "menu.openBrowser": "ブラウザで開く",
        "menu.testNotif": "通知をテスト",
        "menu.chooseMusic": "音楽を選ぶ…",
        "menu.yourMusic": "あなたの音楽：{name}",
        "menu.resetMusic": "生成された音楽に戻す",
        "menu.installHooks": "Claude Codeのフックをインストール…",
        "menu.uninstallHooks": "Claude Codeのフックをアンインストール…",
        "menu.quit": "Terre du Milieuを終了",
        "server.external": "ポート{port}の既存サーバー",
        "server.embedded": "ポート{port}の内蔵サーバー",
        "server.failed": "サーバーを利用できません",
        "server.crashed": "サーバーが何度も停止しました。{path}を確認してください。",
        "server.noNode": "Node.jsが見つかりません。",
        "server.launchFailed": "Nodeを起動できません：{error}",
        "server.musicExternal": "地図はポート{port}ですでに動いているサーバー（npm startなど）を使っています。あなたの音楽はアプリの内蔵サーバーでしか配信できません。そのサーバーを止めてから、アプリを再起動してください。",
        "server.musicUnreadable": "このファイルは音楽として再生できません（形式：mp3、m4a、aac、wav、aiff）。",
        "server.musicRefused": "地図のサーバーが音楽を受け付けませんでした（{error}）。",
        "notif.waitTitle": "🔥 {project}があなたの返事を待っています",
        "notif.someCompany": "ある一行",
        "notif.fires": "のろしが上がりました。",
        "notif.limit95": "⚠️ レンバスがほとんど尽きました",
        "notif.limit80": "⚠️ レンバスが残りわずかです",
        "notif.limitBody": "Claudeの5時間の利用上限の{pct}%。",
        "notif.resetIn": "{left}後にリセット。",
        "notif.testTitle": "🔥 テスト — のろしは正常です",
        "notif.testBody": "エージェントがあなたの返事を待つと、ここでお知らせします。",
        "wait.permission": "{tool}の使用許可を求めている",
        "wait.input": "あなたの返事を待っている",
        "wait.attention": "あなたの注意を求めている",
        "wait.plan": "承認待ちの計画",
        "dur.s": "{n}秒",
        "dur.m": "{n}分",
        "dur.hm": "{h}時間{mm}分",
        "dur.dh": "{d}日{h}時間",
        "fmt.k": "{n}k",
        "fmt.M": "{n}M",
        "fmt.G": "{n}G",
        "fmt.usd": "${n}",
        "alert.ok": "OK",
        "alert.deniedTitle": "通知が拒否されています",
        "alert.deniedText": "macOSがTerre du Milieuの通知をブロックしています。開いたシステム設定 > 通知でTerre du Milieuを選び、「通知を許可」をオンにしてください。",
        "alert.notAuthTitle": "通知が許可されていません",
        "alert.notAuthText": "許可されませんでした（状態：{state}）。このメニューからもう一度お試しください。",
        "alert.nodeTitle": "Node.jsが見つかりません",
        "alert.nodeText": "地図のローカルサーバーを動かすにはNode.js（バージョン18以降）が必要です。\n探した場所：/opt/homebrew/bin/node、/usr/local/bin/node、~/.nvm/versions/node/*/bin/node、そしてzshのログインシェルでの「command -v node」。\nNodeをインストール（「brew install node」やnvmなど）してから、アプリを再起動してください。",
        "alert.nodeOpen": "nodejs.orgを開く",
        "hooks.installQ": "Claude Codeのフックをインストールしますか？",
        "hooks.uninstallQ": "Claude Codeのフックをアンインストールしますか？",
        "hooks.installText": "地図のフックを{settings}に追加します（ほかの設定とフックはそのまま、バックアップはsettings.json.bak-lotr）。\n\n使用するスクリプト：{script}",
        "hooks.uninstallText": "地図のフックを{settings}から削除します（バックアップはsettings.json.bak-lotr）。ほかのフックはそのままです。",
        "hooks.install": "インストール",
        "hooks.uninstall": "アンインストール",
        "hooks.cancel": "キャンセル",
        "hooks.installed": "フックをインストールしました",
        "hooks.uninstalled": "フックをアンインストールしました",
        "hooks.failed": "失敗",
        "hooks.relaunch": "有効にするには、Claude Codeのセッションを再起動してください（または /hooks）。",
        "music.errorTitle": "この音楽は使えません",
        "music.panelTitle": "音楽を選ぶ",
        "music.panelMessage": "ファイルは元の場所に残ります。地図が覚えるのは場所だけです。",
        "music.panelPrompt": "選択",
        "main.about": "Terre du Milieuについて",
        "main.hide": "Terre du Milieuを隠す",
        "main.hideOthers": "ほかを隠す",
        "main.edit": "編集",
        "main.copy": "コピー",
        "main.paste": "ペースト",
        "main.selectAll": "すべてを選択",
        "main.view": "表示",
        "main.fullScreen": "フルスクリーン",
        "main.reload": "再読み込み",
        "main.window": "ウインドウ",
        "main.close": "閉じる",
        "main.minimize": "しまう",
        "main.map": "地図",
        "waiting.title": "地図を広げています…",
        "waiting.starting": "地図のサーバーをポート{port}で起動しています…",
        "waiting.retry": "1秒ごとに再試行します。",
        "focus.menuSessions": "セッション",
        "focus.menuNoSession": "稼働中のセッションはありません",
        "focus.menuSettings": "セッションへの移動",
        "focus.menuDesktopHeader": "Claudeアプリ（デスクトップ）のセッション：",
        "focus.menuDesktopLink": "セッションへの直接リンク",
        "focus.menuDesktopApp": "Claudeを開くだけ",
        "focus.menuNotifHeader": "「返事待ち」の通知をクリックしたとき：",
        "focus.menuNotifSession": "セッションへ行く",
        "focus.menuNotifMap": "地図を開く",
        "focus.menuWaitingTip": "クリックでこのセッションへ",
        "focus.ok": "OK",
        "focus.cancel": "キャンセル",
        "focus.resume": "再開",
        "focus.openMap": "地図を開く",
        "focus.goneTitle": "セッションが見つかりません",
        "focus.goneText": "このエージェントはもう地図にいません。",
        "focus.demoTitle": "デモのセッション",
        "focus.demoText": "デモモードの一行には、実際のClaude Codeのセッションはありません。",
        "focus.noOriginTitle": "セッションの起動元が不明です",
        "focus.noOriginText": "このセッションがどこで動いているか地図にはわかりません。フックの更新前に見つかったか、ターミナルが認識されていません。次のイベントでわかるようになります。",
        "focus.unknownApp": "このセッションは「{what}」で動いており、地図からは前面に出せません。手動で開いてください。",
        "focus.resumeTitle": "このセッションを再開しますか？",
        "focus.resumeEnded": "{project}のセッションは終了しています。ターミナルの新しいウインドウで再開しますか（claude --resume）？",
        "focus.resumeTabMissing": "{project}のセッションに対応する{app}のタブがありません（閉じた？）。ターミナルの新しいウインドウで再開しますか（claude --resume）？",
        "focus.resumeNoId": "このセッションIDは無効なため、自動では再開できません。",
        "focus.automationTitle": "許可が必要です",
        "focus.automationText": "macOSがTerre du Milieuによる{app}の操作を止めています。システム設定 > プライバシーとセキュリティ > オートメーションで、Terre du Milieuに{app}の操作を許可してから、もう一度お試しください。",
        "focus.scriptFailedTitle": "セッションへ移動できません",
        "focus.appMissingTitle": "アプリケーションが見つかりません",
        "focus.appMissingText": "{name}はこのMacにインストールされていません。",
        "focus.thisCompany": "この一行",
    ]
}
