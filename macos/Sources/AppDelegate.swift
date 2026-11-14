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
        focuser.log = { [weak self] line in self?.server.log(line) }
        window.onFocusSession = { [weak self] id in self?.focuser.focus(agentId: id) }
        statusMenu.customMusicName = { [weak self] in self?.userMusic.name }
        statusMenu.serverDescription = { [weak self] in
            switch self?.server.mode {
            case .external: return "Serveur existant sur le port \(AppPaths.port)"
            case .embedded: return "Serveur intégré sur le port \(AppPaths.port)"
            case .failed: return "Serveur indisponible"
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
                alert.messageText = "Notifications refusées"
                alert.informativeText = "macOS bloque les notifications de Terre du Milieu. Dans Réglages Système > Notifications (qui viennent de s'ouvrir), choisis Terre du Milieu et active « Autoriser les notifications »."
                alert.addButton(withTitle: "OK")
                NSApp.activate(ignoringOtherApps: true)
                alert.runModal()
            } else if !tested {
                let alert = NSAlert()
                alert.messageText = "Notifications non autorisées"
                alert.informativeText = "L'autorisation n'a pas été accordée (état : \(state)). Réessaie depuis ce menu."
                alert.addButton(withTitle: "OK")
                alert.runModal()
            }
        }
    }

    private func alertNodeMissing() {
        let alert = NSAlert()
        alert.alertStyle = .critical
        alert.messageText = "Node.js est introuvable"
        alert.informativeText = """
        La carte a besoin de Node.js (version 18 ou plus) pour faire tourner son serveur local.
        Emplacements cherchés : /opt/homebrew/bin/node, /usr/local/bin/node, ~/.nvm/versions/node/*/bin/node, \
        puis « command -v node » dans un shell de connexion zsh.
        Installe Node (par exemple « brew install node » ou nvm), puis relance l'app.
        """
        alert.addButton(withTitle: "OK")
        alert.addButton(withTitle: "Ouvrir nodejs.org")
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
        confirm.messageText = install ? "Installer les hooks Claude Code ?" : "Désinstaller les hooks Claude Code ?"
        confirm.informativeText = install
            ? "Les hooks de la carte vont être ajoutés à \(settings) (tes autres réglages et hooks sont conservés, sauvegarde dans settings.json.bak-lotr).\n\nScript utilisé : \(hookCopy)"
            : "Les hooks de la carte vont être retirés de \(settings) (sauvegarde dans settings.json.bak-lotr). Tes autres hooks sont conservés."
        confirm.addButton(withTitle: install ? "Installer" : "Désinstaller")
        confirm.addButton(withTitle: "Annuler")
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
        done.messageText = p.terminationStatus == 0 ? (install ? "Hooks installés" : "Hooks désinstallés") : "Échec"
        done.informativeText = output.trimmingCharacters(in: .whitespacesAndNewlines)
            + (install && p.terminationStatus == 0 ? "\n\nRelance tes sessions Claude Code (ou /hooks) pour les activer." : "")
        done.runModal()
    }

    // MARK: - custom music ("Ta musique")

    @objc private func chooseMusic() {
        userMusic.choose { [weak self] url in
            guard let self, let url else { return }
            self.server.setUserMusic(url.path) { error in
                if let error {
                    self.server.log("musique perso : refusée (\(error))")
                    self.alert("Impossible d'utiliser cette musique", error)
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
        a.addButton(withTitle: "OK")
        NSApp.activate(ignoringOtherApps: true)
        a.runModal()
    }

    // MARK: - main menu

    private func buildMainMenu() {
        let main = NSMenu()

        let appItem = NSMenuItem()
        let appMenu = NSMenu()
        appMenu.addItem(withTitle: "À propos de Terre du Milieu", action: #selector(NSApplication.orderFrontStandardAboutPanel(_:)), keyEquivalent: "")
        appMenu.addItem(.separator())
        appMenu.addItem(withTitle: "Choisir ta musique…", action: #selector(chooseMusic), keyEquivalent: "").target = self
        appMenu.addItem(withTitle: "Revenir à la musique générée", action: #selector(resetMusic), keyEquivalent: "").target = self
        appMenu.addItem(.separator())
        appMenu.addItem(withTitle: "Masquer Terre du Milieu", action: #selector(NSApplication.hide(_:)), keyEquivalent: "h")
        let others = appMenu.addItem(withTitle: "Masquer les autres", action: #selector(NSApplication.hideOtherApplications(_:)), keyEquivalent: "h")
        others.keyEquivalentModifierMask = [.command, .option]
        appMenu.addItem(.separator())
        appMenu.addItem(withTitle: "Quitter Terre du Milieu", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        appItem.submenu = appMenu
        main.addItem(appItem)

        let editItem = NSMenuItem()
        let edit = NSMenu(title: "Édition")
        edit.addItem(withTitle: "Copier", action: #selector(NSText.copy(_:)), keyEquivalent: "c")
        edit.addItem(withTitle: "Coller", action: #selector(NSText.paste(_:)), keyEquivalent: "v")
        edit.addItem(withTitle: "Tout sélectionner", action: #selector(NSText.selectAll(_:)), keyEquivalent: "a")
        editItem.submenu = edit
        main.addItem(editItem)

        let viewItem = NSMenuItem()
        let view = NSMenu(title: "Présentation")
        let fs = view.addItem(withTitle: "Plein écran", action: #selector(NSWindow.toggleFullScreen(_:)), keyEquivalent: "f")
        fs.keyEquivalentModifierMask = [.command, .control]
        view.addItem(withTitle: "Recharger", action: #selector(reloadMap), keyEquivalent: "r").target = self
        viewItem.submenu = view
        main.addItem(viewItem)

        let windowItem = NSMenuItem()
        let win = NSMenu(title: "Fenêtre")
        win.addItem(withTitle: "Fermer", action: #selector(NSWindow.performClose(_:)), keyEquivalent: "w")
        win.addItem(withTitle: "Réduire", action: #selector(NSWindow.performMiniaturize(_:)), keyEquivalent: "m")
        win.addItem(.separator())
        win.addItem(withTitle: "Carte", action: #selector(showMap), keyEquivalent: "0").target = self
        windowItem.submenu = win
        main.addItem(windowItem)
        NSApp.windowsMenu = win

        NSApp.mainMenu = main
    }

    @objc private func showMap() { window.show() }
    @objc private func reloadMap() { window.startWaiting() }
}
