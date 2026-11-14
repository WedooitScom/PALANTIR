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
    /// Language chosen in the « Langue » submenu (code).
    var onLanguage: ((String) -> Void)?
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
        item.button?.toolTip = L10n.t("app.name")
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
        if l.expired { return L10n.t("menu.limitRefilled", ["name": name]) }
        var line = L10n.t("menu.limitLine", ["name": name, "pct": String(Int(l.pct.rounded()))])
        if let r = l.resetsAt, let left = UsageFormat.countdown(to: r) { line += L10n.t("menu.limitReset", ["left": left]) }
        return line
    }

    func menuNeedsUpdate(_ menu: NSMenu) { rebuild() }

    private func rebuild() {
        menu.removeAllItems()
        if monitor.connected {
            let w = monitor.waiting
            let summary = L10n.t("menu.summary", [
                "companies": L10n.plural("menu.companies", monitor.activeCompanies),
                "coding": L10n.number(Double(monitor.codingCount), 0),
                "waiting": L10n.number(Double(w.count), 0),
            ])
            menu.addItem(disabled(summary))
            if !w.isEmpty {
                menu.addItem(.separator())
                menu.addItem(disabled(L10n.t("menu.waitingHeader")))
                for a in w.prefix(12) {
                    let question = (a.waitingMessage ?? "").replacingOccurrences(of: "\n", with: " ")
                    let title = "🔥 \(a.project.isEmpty ? L10n.t("menu.company") : a.project) — \(clip(question, 70))"
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
                let tag = u.demo ? L10n.t("menu.demoTag") : ""
                if let f = u.five { menu.addItem(disabled(limitLine(L10n.t("menu.five"), f) + tag)) }
                if let s = u.seven { menu.addItem(disabled(limitLine(L10n.t("menu.seven"), s) + tag)) }
                if !u.hasLimits { menu.addItem(disabled(L10n.t("menu.limitsPending"))) }
                if let t = u.todayTokens {
                    var line = L10n.t("menu.tokensToday", ["n": UsageFormat.tokens(t)])
                    if let c = u.todayCost { line += " · \(UsageFormat.usd(c))" }
                    menu.addItem(disabled(line + tag))
                }
            }
        } else {
            menu.addItem(disabled(L10n.t("menu.unreachable")))
        }
        let srv = serverDescription()
        if !srv.isEmpty { menu.addItem(disabled(srv)) }

        menu.addItem(.separator())
        menu.addItem(action(L10n.t("menu.openMap"), #selector(openMap), key: "o"))
        let demo = action(L10n.t("menu.demo"), #selector(toggleDemo))
        demo.state = monitor.demo ? .on : .off
        demo.isEnabled = monitor.connected
        menu.addItem(demo)
        menu.addItem(action(L10n.t("menu.openBrowser"), #selector(openBrowser)))
        menu.addItem(action(L10n.t("menu.testNotif"), #selector(testNotifications)))
        menu.addItem(focusSettingsItem())
        menu.addItem(languageItem())
        menu.addItem(.separator())
        let musicName = customMusicName()
        let choose = action(L10n.t("menu.chooseMusic"), #selector(chooseMusic))
        choose.state = musicName != nil ? .on : .off
        if let n = musicName { choose.toolTip = L10n.t("menu.yourMusic", ["name": n]) }
        menu.addItem(choose)
        let reset = action(L10n.t("menu.resetMusic"), #selector(resetMusic))
        reset.isEnabled = musicName != nil
        menu.addItem(reset)
        menu.addItem(.separator())
        menu.addItem(action(L10n.t("menu.installHooks"), #selector(installHooks)))
        menu.addItem(action(L10n.t("menu.uninstallHooks"), #selector(uninstallHooks)))
        menu.addItem(.separator())
        let quit = NSMenuItem(title: L10n.t("menu.quit"), action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
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
            let mi = NSMenuItem(title: "\(icon) \(s.project.isEmpty ? L10n.t("menu.company") : s.project)\(fire)", action: #selector(focusSession(_:)), keyEquivalent: "")
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

    /// Submenu « Langue »: the 8 languages of the map; the page follows (evaluateJavaScript).
    private func languageItem() -> NSMenuItem {
        let current = L10n.lang
        let item = NSMenuItem(title: "\(L10n.langs.first { $0.code == current }?.flag ?? "🌐") \(L10n.t("menu.language"))", action: nil, keyEquivalent: "")
        let sub = NSMenu()
        sub.autoenablesItems = false
        for l in L10n.langs {
            if l.code == "elf" { sub.addItem(.separator()) }
            let mi = action("\(l.flag)  \(l.name)", #selector(chooseLanguage(_:)))
            mi.representedObject = l.code
            mi.state = l.code == current ? .on : .off
            sub.addItem(mi)
        }
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

    private func clip(_ s: String, _ n: Int) -> String { s.count > n ? String(s.prefix(n - 1)) + "…" : s }

    @objc private func openMap() { onOpenMap?() }
    @objc private func chooseLanguage(_ sender: NSMenuItem) {
        if let code = sender.representedObject as? String { onLanguage?(code) }
    }
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
