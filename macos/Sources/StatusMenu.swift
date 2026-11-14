import AppKit

/// Menu bar item: pixel icon + number of agents waiting, and the app's quick actions.
final class StatusMenu: NSObject, NSMenuDelegate {
    private let item = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
    private let menu = NSMenu()
    private let monitor: StateMonitor

    var onOpenMap: (() -> Void)?
    var onToggleDemo: (() -> Void)?
    var onOpenBrowser: (() -> Void)?
    var onInstallHooks: (() -> Void)?
    var onUninstallHooks: (() -> Void)?
    var onTestNotifications: (() -> Void)?
    var onChooseMusic: (() -> Void)?
    var onResetMusic: (() -> Void)?
    /// « Aller à cette session » (agent id).
    var onFocusSession: ((String) -> Void)?
    /// Name of the custom music file, nil when the generated tune is used.
    var customMusicName: () -> String? = { nil }
    var serverDescription: () -> String = { "" }

    init(monitor: StateMonitor) {
        self.monitor = monitor
        super.init()
        item.button?.image = StatusMenu.icon()
        item.button?.imagePosition = .imageLeft
        item.button?.toolTip = "Terre du Milieu"
        menu.delegate = self
        menu.autoenablesItems = false
        item.menu = menu
        refresh()
    }

    /// Updates the title ("🔥2  5h 21% · 7d 20%") — the menu itself is rebuilt each time it opens.
    func refresh() {
        let n = monitor.waiting.count
        var parts: [String] = []
        if n > 0 { parts.append("🔥\(n)") }
        if let u = monitor.usage, u.hasLimits {
            var lim: [String] = []
            if let f = u.five { lim.append("5h \(f.expired ? 0 : Int(f.pct.rounded()))%") }
            if let s = u.seven { lim.append("7d \(s.expired ? 0 : Int(s.pct.rounded()))%") }
            parts.append(lim.joined(separator: " · "))
        }
        let title = parts.isEmpty ? "" : " " + parts.joined(separator: "  ")
        if item.button?.title != title { item.button?.title = title }
    }

    private func limitLine(_ name: String, _ l: LimitInfo) -> String {
        if l.expired { return "\(name) : réserves reconstituées" }
        var line = "\(name) : \(Int(l.pct.rounded())) %"
        if let r = l.resetsAt, let left = UsageFormat.countdown(to: r) { line += " — reset dans \(left)" }
        return line
    }

    func menuNeedsUpdate(_ menu: NSMenu) { rebuild() }

    private func rebuild() {
        menu.removeAllItems()
        if monitor.connected {
            let w = monitor.waiting
            let summary = "\(plural(monitor.activeCompanies, "compagnie active", "compagnies actives")) · "
                + "\(monitor.codingCount) codent · \(w.count) en attente"
            menu.addItem(disabled(summary))
            if !w.isEmpty {
                menu.addItem(.separator())
                menu.addItem(disabled("En attente de ta réponse"))
                for a in w.prefix(12) {
                    let question = (a.waitingMessage ?? "").replacingOccurrences(of: "\n", with: " ")
                    let title = "🔥 \(a.project.isEmpty ? "Compagnie" : a.project) — \(clip(question, 70))"
                    let mi = NSMenuItem(title: title, action: a.demo ? #selector(openMap) : #selector(focusSession(_:)), keyEquivalent: "")
                    mi.target = self
                    mi.representedObject = a.id
                    mi.toolTip = a.demo ? a.waitingMessage : "\(FocusText.menuWaitingTip)\n\(a.waitingMessage ?? "")"
                    menu.addItem(mi)
                }
            }
            menu.addItem(.separator())
            menu.addItem(sessionsItem())
            if let u = monitor.usage {
                menu.addItem(.separator())
                let tag = u.demo ? " (démo)" : ""
                if let f = u.five { menu.addItem(disabled(limitLine("Lembas (5 h)", f) + tag)) }
                if let s = u.seven { menu.addItem(disabled(limitLine("Greniers (7 j)", s) + tag)) }
                if !u.hasLimits { menu.addItem(disabled("Limites : en attente de la status line")) }
                if let t = u.todayTokens {
                    var line = "Jetons du jour : \(UsageFormat.tokens(t))"
                    if let c = u.todayCost { line += " · \(UsageFormat.usd(c))" }
                    menu.addItem(disabled(line + tag))
                }
            }
        } else {
            menu.addItem(disabled("Serveur de la carte injoignable"))
        }
        let srv = serverDescription()
        if !srv.isEmpty { menu.addItem(disabled(srv)) }

        menu.addItem(.separator())
        menu.addItem(action("Ouvrir la carte", #selector(openMap), key: "o"))
        let demo = action("Mode démo", #selector(toggleDemo))
        demo.state = monitor.demo ? .on : .off
        demo.isEnabled = monitor.connected
        menu.addItem(demo)
        menu.addItem(action("Ouvrir dans le navigateur", #selector(openBrowser)))
        menu.addItem(action("Tester les notifications", #selector(testNotifications)))
        menu.addItem(focusSettingsItem())
        menu.addItem(.separator())
        let musicName = customMusicName()
        let choose = action("Choisir ta musique…", #selector(chooseMusic))
        choose.state = musicName != nil ? .on : .off
        if let n = musicName { choose.toolTip = "Ta musique : \(n)" }
        menu.addItem(choose)
        let reset = action("Revenir à la musique générée", #selector(resetMusic))
        reset.isEnabled = musicName != nil
        menu.addItem(reset)
        menu.addItem(.separator())
        menu.addItem(action("Installer les hooks Claude Code…", #selector(installHooks)))
        menu.addItem(action("Désinstaller les hooks Claude Code…", #selector(uninstallHooks)))
        menu.addItem(.separator())
        let quit = NSMenuItem(title: "Quitter Terre du Milieu", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        menu.addItem(quit)
    }

    /// Submenu « Sessions »: every active real session, click = go to it.
    private func sessionsItem() -> NSMenuItem {
        let item = NSMenuItem(title: FocusText.menuSessions, action: nil, keyEquivalent: "")
        let sub = NSMenu()
        sub.autoenablesItems = false
        let list = monitor.sessions.filter { $0.status != "done" && !$0.demo }
            .sorted { $0.project.localizedCaseInsensitiveCompare($1.project) == .orderedAscending }
        for s in list.prefix(30) {
            let icon = s.origin?.icon ?? "•"
            let fire = s.isWaiting ? " 🔥" : ""
            let mi = NSMenuItem(title: "\(icon) \(s.project.isEmpty ? "Compagnie" : s.project)\(fire)", action: #selector(focusSession(_:)), keyEquivalent: "")
            mi.target = self
            mi.representedObject = s.id
            mi.toolTip = s.cwd
            sub.addItem(mi)
        }
        if sub.items.isEmpty { sub.addItem(disabled(FocusText.menuNoSession)) }
        item.submenu = sub
        return item
    }

    /// Submenu with the two preferences of « Aller à cette session ».
    private func focusSettingsItem() -> NSMenuItem {
        let item = NSMenuItem(title: FocusText.menuSettings, action: nil, keyEquivalent: "")
        let sub = NSMenu()
        sub.autoenablesItems = false
        sub.addItem(disabled(FocusText.menuDesktopHeader))
        let link = action(FocusText.menuDesktopLink, #selector(setDesktopLink))
        link.state = FocusPrefs.desktopMethod == .link ? .on : .off
        let app = action(FocusText.menuDesktopApp, #selector(setDesktopApp))
        app.state = FocusPrefs.desktopMethod == .app ? .on : .off
        sub.addItem(link)
        sub.addItem(app)
        sub.addItem(.separator())
        sub.addItem(disabled(FocusText.menuNotifHeader))
        let ns = action(FocusText.menuNotifSession, #selector(setNotifSession))
        ns.state = FocusPrefs.notificationClick == .session ? .on : .off
        let nm = action(FocusText.menuNotifMap, #selector(setNotifMap))
        nm.state = FocusPrefs.notificationClick == .map ? .on : .off
        sub.addItem(ns)
        sub.addItem(nm)
        item.submenu = sub
        return item
    }

    private func disabled(_ title: String) -> NSMenuItem {
        let mi = NSMenuItem(title: title, action: nil, keyEquivalent: "")
        mi.isEnabled = false
        return mi
    }

    private func action(_ title: String, _ sel: Selector, key: String = "") -> NSMenuItem {
        let mi = NSMenuItem(title: title, action: sel, keyEquivalent: key)
        mi.target = self
        return mi
    }

    private func plural(_ n: Int, _ one: String, _ many: String) -> String { "\(n) \(n > 1 ? many : one)" }

    private func clip(_ s: String, _ n: Int) -> String { s.count > n ? String(s.prefix(n - 1)) + "…" : s }

    @objc private func openMap() { onOpenMap?() }
    @objc private func focusSession(_ sender: NSMenuItem) {
        if let id = sender.representedObject as? String { onFocusSession?(id) }
    }
    @objc private func setDesktopLink() { FocusPrefs.desktopMethod = .link }
    @objc private func setDesktopApp() { FocusPrefs.desktopMethod = .app }
    @objc private func setNotifSession() { FocusPrefs.notificationClick = .session }
    @objc private func setNotifMap() { FocusPrefs.notificationClick = .map }
    @objc private func toggleDemo() { onToggleDemo?() }
    @objc private func openBrowser() { onOpenBrowser?() }
    @objc private func installHooks() { onInstallHooks?() }
    @objc private func uninstallHooks() { onUninstallHooks?() }
    @objc private func testNotifications() { onTestNotifications?() }
    @objc private func chooseMusic() { onChooseMusic?() }
    @objc private func resetMusic() { onResetMusic?() }

    /// 16x13 pixel template icon: the ring above the fire mountain.
    static func icon() -> NSImage {
        let rows = [
            "....########....",
            "..###......###..",
            "..###......###..",
            "....########....",
            "................",
            "......#..#......",
            ".....##..##.....",
            ".....######.....",
            "....########....",
            "...##########...",
            "..############..",
            ".##############.",
            "################",
        ]
        let size = NSSize(width: 16, height: rows.count)
        let img = NSImage(size: size, flipped: true) { _ in
            NSColor.black.setFill()
            for (y, row) in rows.enumerated() {
                for (x, ch) in row.enumerated() where ch == "#" {
                    NSRect(x: x, y: y, width: 1, height: 1).fill()
                }
            }
            return true
        }
        img.isTemplate = true
        return img
    }
}
