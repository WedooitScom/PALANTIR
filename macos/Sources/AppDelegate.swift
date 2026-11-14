import AppKit

final class AppDelegate: NSObject, NSApplicationDelegate {
    private let server = ServerManager()
    private let monitor = StateMonitor()
    private let notifier = Notifier()
    private let userMusic = UserMusic()
    private lazy var focuser = SessionFocuser(monitor: monitor)
    private var window: MainWindowController!
    private var statusMenu: StatusMenu!

    func applicationDidFinishLaunching(_ notification: Notification) {
        buildMainMenu()

        window = MainWindowController()
        window.onRetry = { [weak self] in self?.server.ensureRunning() }
        window.statusText = { [weak self] in self?.server.lastError }

        server.onNodeMissing = { [weak self] in self?.alertNodeMissing() }
        server.userMusicPath = { [weak self] in self?.userMusic.path }

        statusMenu = StatusMenu(monitor: monitor)
        statusMenu.onOpenMap = { [weak self] in self?.window.show() }
        statusMenu.onToggleDemo = { [weak self] in self?.toggleDemo() }
        statusMenu.onOpenBrowser = { NSWorkspace.shared.open(AppPaths.baseURL) }
        statusMenu.onInstallHooks = { [weak self] in self?.runHooksScript(install: true) }
        statusMenu.onUninstallHooks = { [weak self] in self?.runHooksScript(install: false) }
        statusMenu.onTestNotifications = { [weak self] in self?.testNotifications() }
        statusMenu.onChooseMusic = { [weak self] in self?.chooseMusic() }
        statusMenu.onResetMusic = { [weak self] in self?.resetMusic() }
        statusMenu.onFocusSession = { [weak self] id in self?.focuser.focus(agentId: id) }
        // Language: the menu bar submenu tells the page, the page tells the app (same 8 languages).
        statusMenu.onLanguage = { [weak self] code in self?.setLanguage(code, fromPage: false) }
        window.onLangMessage = { [weak self] code in self?.setLanguage(code, fromPage: true) }
        focuser.log = { [weak self] line in self?.server.log(line) }
        window.onFocusSession = { [weak self] id in self?.focuser.focus(agentId: id) }
        statusMenu.customMusicName = { [weak self] in self?.userMusic.name }
        statusMenu.serverDescription = { [weak self] in
            switch self?.server.mode {
            case .external: return L10n.t("server.external", ["port": String(AppPaths.port)])
            case .embedded: return L10n.t("server.embedded", ["port": String(AppPaths.port)])
            case .failed: return L10n.t("server.failed")
            default: return ""
            }
        }

        monitor.onChange = { [weak self] in self?.stateChanged() }
        monitor.onNewWaiting = { [weak self] agent in self?.notifier.notifyWaiting(agent) }
        monitor.onLimitCrossed = { [weak self] level, limit in self?.notifier.notifyLimit(level: level, limit: limit) }
        window.onNotifMessage = { [weak self] action, reply in
            guard let self else { return }
            if action == "request" {
                self.notifier.requestOrTest { state, tested in
                    self.server.log("notifications : bouton 📣 -> état \(state)\(tested ? ", test envoyé" : "")")
                    reply(["type": "notif", "action": "request", "state": state, "tested": tested])
                }
            } else {
                self.notifier.status { state in reply(["type": "notif", "action": "status", "state": state]) }
            }
        }
        window.onPageLog = { [weak self] line in self?.server.log(line) }
        window.onMusicMessage = { [weak self] action in
            if action == "reset" { self?.resetMusic() } else { self?.chooseMusic() }
        }
        // Keeps the "5h 21%" title right when a window expires without new data.
        Timer.scheduledTimer(withTimeInterval: 30, repeats: true) { [weak self] _ in self?.statusMenu.refresh() }
        notifier.onOpen = { [weak self] in self?.window.show() }
        notifier.onOpenAgent = { [weak self] id in
            guard let self else { return }
            if FocusPrefs.notificationClick == .session { self.focuser.focus(agentId: id) } else { self.window.show() }
        }
        notifier.setUp()

        server.ensureRunning()
        monitor.start()
        window.show()
    }

    /// Closing the window keeps the app (and its menu bar item) alive.
    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { false }

    /// Clicking the Dock icon brings the map back.
    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        window.show()
        return true
    }

    func applicationWillTerminate(_ notification: Notification) {
        server.stop()
    }

    private func stateChanged() {
        statusMenu.refresh()
        let n = monitor.waiting.count
        NSApp.dockTile.badgeLabel = n > 0 ? String(n) : nil
    }

    // MARK: - language

    /// fromPage: the map changed its language (bridge); otherwise the menu bar did, and the page follows.
    private func setLanguage(_ code: String, fromPage: Bool) {
        guard L10n.isLang(code) else { return }
        let changed = L10n.set(code)
        server.log("langue : \(fromPage ? "page" : "menu") -> \(code)\(changed ? "" : " (inchangée)")")
        window.languageChanged()
        if !fromPage { window.sendToPage(["type": "lang", "lang": code]) }
        guard changed else { return }
        buildMainMenu()
        statusMenu.refresh()
    }

    // MARK: - actions

    private func toggleDemo() {
        let on = !monitor.demo
        var req = URLRequest(url: AppPaths.url(on ? "/demo/start" : "/demo/stop"))
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = Data("{}".utf8)
        URLSession.shared.dataTask(with: req) { [weak self] data, _, _ in
            let obj = data.flatMap { try? JSONSerialization.jsonObject(with: $0) } as? [String: Any]
            DispatchQueue.main.async {
                if let demo = obj?["demo"] as? Bool { self?.monitor.setDemo(demo) }
            }
        }.resume()
    }

    /// Menu « Tester les notifications »: same logic as the 📣 button of the map.
    private func testNotifications() {
        notifier.requestOrTest { [weak self] state, tested in
            guard let self else { return }
            self.server.log("notifications : menu -> état \(state)\(tested ? ", test envoyé" : "")")
            self.window.sendToPage(["type": "notif", "action": "status", "state": state])
            if state == "denied" {
                let alert = NSAlert()
                alert.messageText = L10n.t("alert.deniedTitle")
                alert.informativeText = L10n.tb("alert.deniedText")
                alert.addButton(withTitle: L10n.tm("alert.ok"))
                NSApp.activate(ignoringOtherApps: true)
                alert.runModal()
            } else if !tested {
                let alert = NSAlert()
                alert.messageText = L10n.t("alert.notAuthTitle")
                alert.informativeText = L10n.tb("alert.notAuthText", ["state": state])
                alert.addButton(withTitle: L10n.tm("alert.ok"))
                alert.runModal()
            }
        }
    }

    private func alertNodeMissing() {
        let alert = NSAlert()
        alert.alertStyle = .critical
        alert.messageText = L10n.t("alert.nodeTitle")
        alert.informativeText = L10n.tb("alert.nodeText")
        alert.addButton(withTitle: L10n.tm("alert.ok"))
        alert.addButton(withTitle: L10n.tm("alert.nodeOpen"))
        NSApp.activate(ignoringOtherApps: true)
        if alert.runModal() == .alertSecondButtonReturn {
            NSWorkspace.shared.open(URL(string: "https://nodejs.org/")!)
        }
    }

    /// Runs scripts/install-hooks.mjs or uninstall-hooks.mjs from the embedded copy, after confirmation.
    /// The hook script is copied to Application Support so moving the app never breaks settings.json.
    private func runHooksScript(install: Bool) {
        let settings = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent(".claude/settings.json").path
        let hookCopy = AppPaths.supportDir.appendingPathComponent("send-event.sh").path
        let confirm = NSAlert()
        confirm.messageText = L10n.t(install ? "hooks.installQ" : "hooks.uninstallQ")
        confirm.informativeText = install
            ? L10n.tb("hooks.installText", ["settings": settings, "script": hookCopy])
            : L10n.tb("hooks.uninstallText", ["settings": settings])
        confirm.addButton(withTitle: L10n.tm(install ? "hooks.install" : "hooks.uninstall"))
        confirm.addButton(withTitle: L10n.tm("hooks.cancel"))
        NSApp.activate(ignoringOtherApps: true)
        guard confirm.runModal() == .alertFirstButtonReturn else { return }

        guard let node = NodeLocator.find() else { alertNodeMissing(); return }
        let script = AppPaths.appResources.appendingPathComponent(install ? "scripts/install-hooks.mjs" : "scripts/uninstall-hooks.mjs")
        let p = Process()
        p.executableURL = node
        p.arguments = [script.path]
        p.currentDirectoryURL = AppPaths.appResources
        var env = ProcessInfo.processInfo.environment
        env["LOTR_HOOK_DIR"] = AppPaths.supportDir.path
        p.environment = env
        let pipe = Pipe()
        p.standardOutput = pipe
        p.standardError = pipe
        var output = ""
        do {
            try p.run()
            output = String(decoding: pipe.fileHandleForReading.readDataToEndOfFile(), as: UTF8.self)
            p.waitUntilExit()
        } catch {
            output = error.localizedDescription
        }
        let done = NSAlert()
        done.alertStyle = p.terminationStatus == 0 ? .informational : .warning
        done.messageText = p.terminationStatus == 0 ? L10n.t(install ? "hooks.installed" : "hooks.uninstalled") : L10n.t("hooks.failed")
        done.informativeText = output.trimmingCharacters(in: .whitespacesAndNewlines)
            + (install && p.terminationStatus == 0 ? "\n\n" + L10n.tb("hooks.relaunch") : "")
        done.runModal()
    }

    // MARK: - custom music ("Ta musique")

    @objc private func chooseMusic() {
        userMusic.choose { [weak self] url in
            guard let self, let url else { return }
            self.server.setUserMusic(url.path) { error in
                if let error {
                    self.server.log("musique perso : refusée (\(error))")
                    self.alert(L10n.t("music.errorTitle"), error)
                    return
                }
                self.userMusic.remember(url)
                self.server.log("musique perso : fichier choisi (\(url.pathExtension))")
                self.window.sendToPage(["type": "music", "source": "custom"])
            }
        }
    }

    @objc private func resetMusic() {
        userMusic.clear()
        server.setUserMusic(nil) { [weak self] _ in
            self?.server.log("musique perso : retour à la musique générée")
            self?.window.sendToPage(["type": "music", "source": "generated"])
        }
    }

    private func alert(_ title: String, _ text: String) {
        let a = NSAlert()
        a.messageText = title
        a.informativeText = text
        a.addButton(withTitle: L10n.tm("alert.ok"))
        NSApp.activate(ignoringOtherApps: true)
        a.runModal()
    }

    // MARK: - main menu

    private func buildMainMenu() {
        let main = NSMenu()

        let appItem = NSMenuItem()
        let appMenu = NSMenu()
        appMenu.addItem(withTitle: L10n.tm("main.about"), action: #selector(NSApplication.orderFrontStandardAboutPanel(_:)), keyEquivalent: "")
        appMenu.addItem(.separator())
        appMenu.addItem(withTitle: L10n.tm("menu.chooseMusic"), action: #selector(chooseMusic), keyEquivalent: "").target = self
        appMenu.addItem(withTitle: L10n.tm("menu.resetMusic"), action: #selector(resetMusic), keyEquivalent: "").target = self
        appMenu.addItem(.separator())
        appMenu.addItem(withTitle: L10n.tm("main.hide"), action: #selector(NSApplication.hide(_:)), keyEquivalent: "h")
        let others = appMenu.addItem(withTitle: L10n.tm("main.hideOthers"), action: #selector(NSApplication.hideOtherApplications(_:)), keyEquivalent: "h")
        others.keyEquivalentModifierMask = [.command, .option]
        appMenu.addItem(.separator())
        appMenu.addItem(withTitle: L10n.tm("menu.quit"), action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        appItem.submenu = appMenu
        main.addItem(appItem)

        let editItem = NSMenuItem()
        let edit = NSMenu(title: L10n.t("main.edit"))
        edit.addItem(withTitle: L10n.tm("main.copy"), action: #selector(NSText.copy(_:)), keyEquivalent: "c")
        edit.addItem(withTitle: L10n.tm("main.paste"), action: #selector(NSText.paste(_:)), keyEquivalent: "v")
        edit.addItem(withTitle: L10n.tm("main.selectAll"), action: #selector(NSText.selectAll(_:)), keyEquivalent: "a")
        editItem.submenu = edit
        main.addItem(editItem)

        let viewItem = NSMenuItem()
        let view = NSMenu(title: L10n.t("main.view"))
        let fs = view.addItem(withTitle: L10n.tm("main.fullScreen"), action: #selector(NSWindow.toggleFullScreen(_:)), keyEquivalent: "f")
        fs.keyEquivalentModifierMask = [.command, .control]
        view.addItem(withTitle: L10n.tm("main.reload"), action: #selector(reloadMap), keyEquivalent: "r").target = self
        viewItem.submenu = view
        main.addItem(viewItem)

        let windowItem = NSMenuItem()
        let win = NSMenu(title: L10n.t("main.window"))
        win.addItem(withTitle: L10n.tm("main.close"), action: #selector(NSWindow.performClose(_:)), keyEquivalent: "w")
        win.addItem(withTitle: L10n.tm("main.minimize"), action: #selector(NSWindow.performMiniaturize(_:)), keyEquivalent: "m")
        win.addItem(.separator())
        win.addItem(withTitle: L10n.tm("main.map"), action: #selector(showMap), keyEquivalent: "0").target = self
        windowItem.submenu = win
        main.addItem(windowItem)
        NSApp.windowsMenu = win

        NSApp.mainMenu = main
    }

    @objc private func showMap() { window.show() }
    @objc private func reloadMap() { window.startWaiting() }
}
