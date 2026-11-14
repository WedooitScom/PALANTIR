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

    /// Updates the title ("🔥2") — the menu itself is rebuilt each time it opens.
    func refresh() {
        let n = monitor.waiting.count
        item.button?.title = n > 0 ? " 🔥\(n)" : ""
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
                    let mi = NSMenuItem(title: title, action: #selector(openMap), keyEquivalent: "")
                    mi.target = self
                    mi.toolTip = a.waitingMessage
                    menu.addItem(mi)
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
        menu.addItem(.separator())
        menu.addItem(action("Installer les hooks Claude Code…", #selector(installHooks)))
        menu.addItem(action("Désinstaller les hooks Claude Code…", #selector(uninstallHooks)))
        menu.addItem(.separator())
        let quit = NSMenuItem(title: "Quitter Terre du Milieu", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        menu.addItem(quit)
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
    @objc private func toggleDemo() { onToggleDemo?() }
    @objc private func openBrowser() { onOpenBrowser?() }
    @objc private func installHooks() { onInstallHooks?() }
    @objc private func uninstallHooks() { onUninstallHooks?() }

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
