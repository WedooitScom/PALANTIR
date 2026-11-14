import AppKit
import Darwin

// « Aller à cette session »: brings the real Claude Code session of an agent to the front.
//
// Security: the page (or a menu item, a notification) only gives an agent id. Everything else is
// read from the app's own state (StateMonitor, fed by the local server), and every value handed to
// AppleScript or NSWorkspace is validated by a regex and escaped. No shell is ever involved.

/// UI strings of this feature (L10n, in the language chosen on the map).
enum FocusText {
    static var menuSessions: String { L10n.t("focus.menuSessions") }
    static var menuNoSession: String { L10n.t("focus.menuNoSession") }
    static var menuSettings: String { L10n.t("focus.menuSettings") }
    static var menuDesktopHeader: String { L10n.t("focus.menuDesktopHeader") }
    static var menuDesktopLink: String { L10n.t("focus.menuDesktopLink") }
    static var menuDesktopApp: String { L10n.t("focus.menuDesktopApp") }
    static var menuNotifHeader: String { L10n.t("focus.menuNotifHeader") }
    static var menuNotifSession: String { L10n.t("focus.menuNotifSession") }
    static var menuNotifMap: String { L10n.t("focus.menuNotifMap") }
    static var menuWaitingTip: String { L10n.t("focus.menuWaitingTip") }

    static var ok: String { L10n.t("focus.ok") }
    static var cancel: String { L10n.t("focus.cancel") }
    static var resume: String { L10n.t("focus.resume") }
    static var openMap: String { L10n.t("focus.openMap") }

    static var goneTitle: String { L10n.t("focus.goneTitle") }
    static var goneText: String { L10n.t("focus.goneText") }
    static var demoTitle: String { L10n.t("focus.demoTitle") }
    static var demoText: String { L10n.t("focus.demoText") }
    static var noOriginTitle: String { L10n.t("focus.noOriginTitle") }
    static var noOriginText: String { L10n.t("focus.noOriginText") }
    static func unknownAppText(_ what: String) -> String { L10n.t("focus.unknownApp", ["what": what]) }
    static var resumeTitle: String { L10n.t("focus.resumeTitle") }
    static func resumeEnded(_ project: String) -> String { L10n.t("focus.resumeEnded", ["project": project]) }
    static func resumeTabMissing(_ app: String, _ project: String) -> String {
        L10n.t("focus.resumeTabMissing", ["app": app, "project": project])
    }
    static var resumeNoId: String { L10n.t("focus.resumeNoId") }
    static var automationTitle: String { L10n.t("focus.automationTitle") }
    static func automationText(_ app: String) -> String { L10n.t("focus.automationText", ["app": app]) }
    static var scriptFailedTitle: String { L10n.t("focus.scriptFailedTitle") }
    static var appMissingTitle: String { L10n.t("focus.appMissingTitle") }
    static func appMissingText(_ name: String) -> String { L10n.t("focus.appMissingText", ["name": name]) }
}

/// Preferences of the feature (UserDefaults).
enum FocusPrefs {
    enum DesktopMethod: String { case link, app }
    enum NotificationClick: String { case session, map }

    private static let desktopKey = "focus.desktopMethod"
    private static let notifKey = "focus.notificationClick"

    static var desktopMethod: DesktopMethod {
        get { DesktopMethod(rawValue: UserDefaults.standard.string(forKey: desktopKey) ?? "") ?? .link }
        set { UserDefaults.standard.set(newValue.rawValue, forKey: desktopKey) }
    }

    static var notificationClick: NotificationClick {
        get { NotificationClick(rawValue: UserDefaults.standard.string(forKey: notifKey) ?? "") ?? .session }
        set { UserDefaults.standard.set(newValue.rawValue, forKey: notifKey) }
    }
}

/// Strict validation helpers (whole-string matches only).
enum Validate {
    static func matches(_ s: String, _ pattern: String) -> Bool {
        guard let r = s.range(of: pattern, options: .regularExpression) else { return false }
        return r == s.startIndex..<s.endIndex
    }

    static let uuid = "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$"
    static let hostSessionId = "^local_[A-Za-z0-9-]{1,64}$"
    static let tty = "^/dev/ttys[0-9]{1,4}$"
    static let bundleId = "^[A-Za-z0-9.-]{1,128}$"
    static let itermUniqueId = "^[A-Za-z0-9-]{1,64}$"

    /// An existing directory given as an absolute path without control characters.
    static func directory(_ path: String) -> String? {
        guard path.hasPrefix("/"), path.count <= 1024,
              !path.unicodeScalars.contains(where: { CharacterSet.controlCharacters.contains($0) }) else { return nil }
        var isDir: ObjCBool = false
        guard FileManager.default.fileExists(atPath: path, isDirectory: &isDir), isDir.boolValue else { return nil }
        return path
    }

    /// AppleScript string literal: backslashes and quotes escaped, control characters refused.
    static func appleScriptLiteral(_ s: String) -> String? {
        guard !s.unicodeScalars.contains(where: { CharacterSet.controlCharacters.contains($0) }) else { return nil }
        let escaped = s.replacingOccurrences(of: "\\", with: "\\\\").replacingOccurrences(of: "\"", with: "\\\"")
        return "\"\(escaped)\""
    }
}

/// Where a session runs, as sent by the hook script and stored by the server. Every field is
/// validated again here: a value that does not match its pattern is dropped.
struct SessionOrigin {
    let entrypoint: String?
    let hostSessionId: String?
    let termProgram: String?
    let bundleId: String?
    let itermSessionId: String?
    let tty: String?
    let claudePid: pid_t?

    init?(_ v: Any?) {
        guard let d = v as? [String: Any] else { return nil }
        func field(_ key: String, _ pattern: String) -> String? {
            guard let s = d[key] as? String, Validate.matches(s, pattern) else { return nil }
            return s
        }
        entrypoint = field("entrypoint", "^[a-z0-9_-]{1,32}$")
        hostSessionId = field("hostSessionId", Validate.hostSessionId)
        termProgram = field("termProgram", "^[A-Za-z0-9._-]{1,64}$")
        bundleId = field("bundleId", Validate.bundleId)
        itermSessionId = field("itermSessionId", "^[A-Za-z0-9:-]{1,80}$")
        tty = field("tty", Validate.tty)
        if let n = (d["claudePid"] as? NSNumber)?.int64Value, n > 1, n < Int64(Int32.max) {
            claudePid = pid_t(n)
        } else {
            claudePid = nil
        }
        if entrypoint == nil && hostSessionId == nil && termProgram == nil && bundleId == nil
            && itermSessionId == nil && tty == nil && claudePid == nil { return nil }
    }

    var isDesktop: Bool { entrypoint == "claude-desktop" }

    /// Small icon for the menus: 🖥️ desktop app, ⌨️ terminal, 🧩 editor.
    var icon: String {
        if isDesktop { return "🖥️" }
        if termProgram == "vscode" { return "🧩" }
        return termProgram == nil ? "•" : "⌨️"
    }
}

final class SessionFocuser {
    static let claudeBundleId = "com.anthropic.claudefordesktop"
    static let terminalBundleId = "com.apple.Terminal"
    static let itermBundleId = "com.googlecode.iterm2"
    /// Editors of the VS Code family (TERM_PROGRAM=vscode), by bundle id.
    static let editors: [String: String] = [
        "com.microsoft.VSCode": "Visual Studio Code",
        "com.microsoft.VSCodeInsiders": "Visual Studio Code - Insiders",
        "com.todesktop.230313mzl4w4u92": "Cursor",
        "com.vscodium": "VSCodium",
        "com.exafunction.windsurf": "Windsurf",
    ]

    private let monitor: StateMonitor
    /// Used to report what happened (server.log).
    var log: (String) -> Void = { _ in }

    init(monitor: StateMonitor) {
        self.monitor = monitor
    }

    /// Entry point (page bridge, menu bar, notification). Only the agent id comes from outside.
    func focus(agentId: String) {
        guard let agent = monitor.agents[agentId] else {
            alert(FocusText.goneTitle, FocusText.goneText)
            return
        }
        let session = agent.kind == "subagent" ? (monitor.agents[agent.sessionId] ?? agent) : agent
        if session.demo {
            alert(FocusText.demoTitle, FocusText.demoText)
            return
        }
        let origin = session.origin
        let ended = isEnded(session)

        if origin?.isDesktop == true {
            if !ended, FocusPrefs.desktopMethod == .link, let h = origin?.hostSessionId,
               Validate.matches(h, Validate.hostSessionId),
               let url = URL(string: "claude://code/continue?session=\(h)") {
                // Undocumented deep link of Claude.app; it may be ignored (internal setting), and that
                // cannot be detected: Claude is always activated as well.
                let opened = NSWorkspace.shared.open(url)
                log("session : lien direct claude://code/continue (\(opened ? "transmis" : "refusé"))")
            }
            activateApp(bundleId: SessionFocuser.claudeBundleId, name: "Claude")
            return
        }
        if ended {
            offerResume(session, FocusText.resumeEnded(name(session)))
            return
        }
        guard let origin else {
            alert(FocusText.noOriginTitle, FocusText.noOriginText)
            return
        }
        switch origin.termProgram {
        case "Apple_Terminal":
            focusTab(app: "Terminal", bundleId: SessionFocuser.terminalBundleId, session: session, origin: origin)
        case "iTerm.app":
            focusTab(app: "iTerm2", bundleId: SessionFocuser.itermBundleId, session: session, origin: origin)
        case "vscode":
            openEditor(origin: origin, session: session)
        default:
            if let b = origin.bundleId, Validate.matches(b, Validate.bundleId),
               NSWorkspace.shared.urlForApplication(withBundleIdentifier: b) != nil {
                activateApp(bundleId: b, name: b)
            } else {
                alert(FocusText.noOriginTitle, FocusText.unknownAppText(origin.termProgram ?? origin.entrypoint ?? "?"))
            }
        }
    }

    private func name(_ s: AgentInfo) -> String { s.project.isEmpty ? L10n.t("focus.thisCompany") : s.project }

    // MARK: - ended sessions

    /// Ended: its Claude Code process is gone (when known), or the server marked it done.
    /// A session only marked done for inactivity whose process still runs is focused normally.
    private func isEnded(_ s: AgentInfo) -> Bool {
        if let pid = s.origin?.claudePid { return !SessionFocuser.processAlive(pid) }
        return s.status == "done"
    }

    static func processAlive(_ pid: pid_t) -> Bool {
        guard pid > 1 else { return false }
        if kill(pid, 0) != 0 && errno != EPERM { return false }
        // Guard against pid reuse: when the path is readable it must look like Claude Code.
        var buf = [CChar](repeating: 0, count: 4 * Int(MAXPATHLEN))
        let n = proc_pidpath(pid, &buf, UInt32(buf.count))
        guard n > 0 else { return true }
        let path = String(cString: buf).lowercased()
        return path.contains("claude") || path.hasSuffix("/node") || path.hasSuffix("/bun")
    }

    private func offerResume(_ s: AgentInfo, _ text: String) {
        let a = NSAlert()
        a.messageText = FocusText.resumeTitle
        a.informativeText = text
        a.addButton(withTitle: FocusText.resume)
        a.addButton(withTitle: FocusText.cancel)
        NSApp.activate(ignoringOtherApps: true)
        guard a.runModal() == .alertFirstButtonReturn else { return }
        guard Validate.matches(s.sessionId, Validate.uuid), let sid = Validate.appleScriptLiteral(s.sessionId) else {
            alert(FocusText.scriptFailedTitle, FocusText.resumeNoId)
            return
        }
        // `quoted form of` does the shell quoting of the folder inside Terminal.
        var command = "\"claude --resume \" & quoted form of \(sid)"
        if let dir = Validate.directory(s.cwd), let lit = Validate.appleScriptLiteral(dir) {
            command = "\"cd \" & quoted form of \(lit) & \" && claude --resume \" & quoted form of \(sid)"
        }
        let source = """
        tell application id "\(SessionFocuser.terminalBundleId)"
            activate
            do script \(command)
        end tell
        return "ok"
        """
        _ = run(source, app: "Terminal")
        log("session : reprise proposée et acceptée (Terminal)")
    }

    // MARK: - terminals

    private func focusTab(app: String, bundleId: String, session: AgentInfo, origin: SessionOrigin) {
        // Never launch the terminal just to search it (that would open a new window).
        let running = !NSRunningApplication.runningApplications(withBundleIdentifier: bundleId).isEmpty
        let tty = origin.tty.flatMap { Validate.matches($0, Validate.tty) ? Validate.appleScriptLiteral($0) : nil }
        var uid: String?
        if bundleId == SessionFocuser.itermBundleId, let id = origin.itermSessionId, let colon = id.lastIndex(of: ":") {
            let u = String(id[id.index(after: colon)...])
            if Validate.matches(u, Validate.itermUniqueId) { uid = Validate.appleScriptLiteral(u) }
        }
        guard running, tty != nil || uid != nil else {
            offerResume(session, FocusText.resumeTabMissing(app, name(session)))
            return
        }
        let source: String
        if bundleId == SessionFocuser.terminalBundleId {
            source = """
            tell application id "\(bundleId)"
                repeat with w in windows
                    try
                        repeat with t in tabs of w
                            if tty of t is \(tty!) then
                                if miniaturized of w then set miniaturized of w to false
                                set selected tab of w to t
                                set index of w to 1
                                activate
                                return "ok"
                            end if
                        end repeat
                    end try
                end repeat
            end tell
            return "notfound"
            """
        } else {
            let ttyLit = tty ?? "\"-\""
            let uidLit = uid ?? "\"-\""
            source = """
            tell application id "\(bundleId)"
                repeat with w in windows
                    repeat with t in tabs of w
                        repeat with s in sessions of t
                            if (tty of s is \(ttyLit)) or (unique id of s is \(uidLit)) then
                                select w
                                select t
                                select s
                                activate
                                return "ok"
                            end if
                        end repeat
                    end repeat
                end repeat
            end tell
            return "notfound"
            """
        }
        guard let result = run(source, app: app) else { return }
        log("session : \(app) -> \(result)")
        if result != "ok" { offerResume(session, FocusText.resumeTabMissing(app, name(session))) }
    }

    /// Runs an AppleScript; nil after an error (already reported to the user).
    private func run(_ source: String, app: String) -> String? {
        guard let script = NSAppleScript(source: source) else { return nil }
        var error: NSDictionary?
        let result = script.executeAndReturnError(&error)
        if let error {
            let code = (error[NSAppleScript.errorNumber] as? NSNumber)?.intValue ?? 0
            log("session : AppleScript \(app) erreur \(code)")
            if code == -1743 || code == -1744 {
                alert(FocusText.automationTitle, FocusText.automationText(app))
            } else {
                let msg = error[NSAppleScript.errorMessage] as? String ?? "erreur \(code)"
                alert(FocusText.scriptFailedTitle, "\(app) : \(msg)")
            }
            return nil
        }
        return result.stringValue ?? ""
    }

    // MARK: - apps

    private func openEditor(origin: SessionOrigin, session: AgentInfo) {
        var bundle = "com.microsoft.VSCode"
        if let b = origin.bundleId, SessionFocuser.editors[b] != nil { bundle = b }
        let appName = SessionFocuser.editors[bundle] ?? bundle
        guard let appURL = NSWorkspace.shared.urlForApplication(withBundleIdentifier: bundle) else {
            alert(FocusText.appMissingTitle, FocusText.appMissingText(appName))
            return
        }
        let cfg = NSWorkspace.OpenConfiguration()
        cfg.activates = true
        if let dir = Validate.directory(session.cwd) {
            // Same as `open -a <editor> <folder>`: the editor focuses the window of that folder.
            NSWorkspace.shared.open([URL(fileURLWithPath: dir, isDirectory: true)], withApplicationAt: appURL, configuration: cfg) { [weak self] _, err in
                if let err { DispatchQueue.main.async { self?.log("session : \(appName) -> \(err.localizedDescription)") } }
            }
        } else {
            NSWorkspace.shared.openApplication(at: appURL, configuration: cfg) { _, _ in }
        }
        log("session : \(appName)")
    }

    /// Brings an app to the front (launches it if needed).
    private func activateApp(bundleId: String, name: String) {
        guard let url = NSWorkspace.shared.urlForApplication(withBundleIdentifier: bundleId) else {
            alert(FocusText.appMissingTitle, FocusText.appMissingText(name))
            return
        }
        if let running = NSRunningApplication.runningApplications(withBundleIdentifier: bundleId).first {
            running.unhide()
        }
        let cfg = NSWorkspace.OpenConfiguration()
        cfg.activates = true
        NSWorkspace.shared.openApplication(at: url, configuration: cfg) { _, _ in }
    }

    private func alert(_ title: String, _ text: String) {
        let a = NSAlert()
        a.messageText = title
        a.informativeText = text
        a.addButton(withTitle: FocusText.ok)
        NSApp.activate(ignoringOtherApps: true)
        a.runModal()
    }
}
