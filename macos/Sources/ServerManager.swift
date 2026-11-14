import Foundation

/// Reuses a server already listening on the port, or runs the embedded one (`node server.js`) as a
/// child process that is stopped when the app quits.
final class ServerManager {
    enum Mode { case unknown, external, embedded, failed }

    private(set) var mode: Mode = .unknown
    private(set) var lastError: String?
    private var process: Process?
    private var spawnAttempts = 0
    private var checking = false

    /// Called on the main queue when the server cannot be started because Node is missing.
    var onNodeMissing: (() -> Void)?

    var isChildRunning: Bool { process?.isRunning ?? false }

    /// Health check on /state (1 s timeout). Completion on the main queue.
    static func ping(_ completion: @escaping (Bool) -> Void) {
        var req = URLRequest(url: AppPaths.url("/state"))
        req.httpMethod = "HEAD"
        req.timeoutInterval = 1
        req.cachePolicy = .reloadIgnoringLocalCacheData
        URLSession.shared.dataTask(with: req) { _, resp, _ in
            let ok = (resp as? HTTPURLResponse)?.statusCode == 200
            DispatchQueue.main.async { completion(ok) }
        }.resume()
    }

    /// Makes sure something answers on the port: reuse it, or spawn the embedded server.
    /// Safe to call repeatedly (the window's retry loop does).
    func ensureRunning() {
        if checking || isChildRunning || mode == .failed { return }
        checking = true
        ServerManager.ping { [weak self] ok in
            guard let self else { return }
            self.checking = false
            if ok {
                if self.mode != .embedded { self.mode = .external }
                return
            }
            if self.isChildRunning { return }
            // Give up after a few crashes so a broken install does not respawn forever.
            if self.spawnAttempts >= 3 {
                self.mode = .failed
                self.lastError = "Le serveur s'est arrêté plusieurs fois. Consulte \(AppPaths.serverLog.path)."
                return
            }
            self.spawn()
        }
    }

    private func spawn() {
        guard let node = NodeLocator.find() else {
            mode = .failed
            lastError = "Node.js est introuvable."
            log("Node.js introuvable : serveur non démarré.")
            onNodeMissing?()
            return
        }
        spawnAttempts += 1
        let appDir = AppPaths.appResources
        let p = Process()
        p.executableURL = node
        p.arguments = [appDir.appendingPathComponent("server.js").path]
        p.currentDirectoryURL = appDir
        var env = ProcessInfo.processInfo.environment
        env["PORT"] = String(AppPaths.port)
        env["LOTR_DATA_DIR"] = AppPaths.supportDir.path
        env["LOTR_PARENT_PID"] = String(ProcessInfo.processInfo.processIdentifier)
        env["PATH"] = node.deletingLastPathComponent().path + ":/usr/bin:/bin:/usr/sbin:/sbin"
        env.removeValue(forKey: "DEMO")
        p.environment = env
        let handle = logHandle()
        p.standardOutput = handle
        p.standardError = handle
        p.standardInput = FileHandle.nullDevice
        p.terminationHandler = { [weak self] proc in
            let status = proc.terminationStatus
            DispatchQueue.main.async {
                self?.log("Serveur arrêté (code \(status)).")
                if self?.process === proc { self?.process = nil }
            }
        }
        log("Démarrage : \(node.path) server.js (port \(AppPaths.port), cwd \(appDir.path))")
        do {
            try p.run()
            process = p
            mode = .embedded
            log("Serveur lancé, pid \(p.processIdentifier).")
        } catch {
            lastError = "Impossible de lancer Node : \(error.localizedDescription)"
            log(lastError!)
        }
    }

    /// Stops the child server (SIGTERM, then SIGKILL after 1.5 s). Never touches an external server.
    func stop() {
        guard let p = process, p.isRunning else { return }
        log("Arrêt du serveur embarqué (pid \(p.processIdentifier)).")
        p.terminate()
        let deadline = Date().addingTimeInterval(1.5)
        while p.isRunning && Date() < deadline { usleep(50_000) }
        if p.isRunning { kill(p.processIdentifier, SIGKILL) }
        process = nil
    }

    // MARK: - log file

    private func logHandle() -> FileHandle {
        let url = AppPaths.serverLog
        if !FileManager.default.fileExists(atPath: url.path) {
            FileManager.default.createFile(atPath: url.path, contents: nil)
        }
        // Keep the log small: start over above 2 MB.
        if let size = (try? FileManager.default.attributesOfItem(atPath: url.path)[.size]) as? Int, size > 2_000_000 {
            try? Data().write(to: url)
        }
        // O_APPEND: the app and the node child write to the same file without overwriting each other.
        let fd = open(url.path, O_WRONLY | O_APPEND | O_CREAT, 0o644)
        guard fd >= 0 else { return FileHandle.nullDevice }
        return FileHandle(fileDescriptor: fd, closeOnDealloc: true)
    }

    func log(_ message: String) {
        let line = "[app \(ISO8601DateFormatter().string(from: Date()))] \(message)\n"
        let h = logHandle()
        h.write(line.data(using: .utf8)!)
    }
}

/// Finds `node` without relying on the Finder's minimal PATH.
enum NodeLocator {
    static func find() -> URL? {
        let fm = FileManager.default
        for path in ["/opt/homebrew/bin/node", "/usr/local/bin/node"] where fm.isExecutableFile(atPath: path) {
            return URL(fileURLWithPath: path)
        }
        if let nvm = highestNvmNode() { return nvm }
        return fromLoginShell()
    }

    /// Highest version in ~/.nvm/versions/node/*/bin/node.
    static func highestNvmNode() -> URL? {
        let root = FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent(".nvm/versions/node", isDirectory: true)
        guard let dirs = try? FileManager.default.contentsOfDirectory(atPath: root.path) else { return nil }
        func version(_ s: String) -> [Int] {
            s.trimmingCharacters(in: CharacterSet(charactersIn: "v")).split(separator: ".").map { Int($0) ?? 0 }
        }
        let sorted = dirs.filter { $0.hasPrefix("v") }.sorted { version($0).lexicographicallyPrecedes(version($1)) }
        for d in sorted.reversed() {
            let bin = root.appendingPathComponent(d).appendingPathComponent("bin/node")
            if FileManager.default.isExecutableFile(atPath: bin.path) { return bin }
        }
        return nil
    }

    /// Last resort: ask a login shell (`/bin/zsh -lc 'command -v node'`), 5 s max.
    static func fromLoginShell() -> URL? {
        let p = Process()
        p.executableURL = URL(fileURLWithPath: "/bin/zsh")
        p.arguments = ["-lc", "command -v node"]
        let pipe = Pipe()
        p.standardOutput = pipe
        p.standardError = FileHandle.nullDevice
        p.standardInput = FileHandle.nullDevice
        do { try p.run() } catch { return nil }
        let deadline = Date().addingTimeInterval(5)
        while p.isRunning && Date() < deadline { usleep(50_000) }
        if p.isRunning { p.terminate(); return nil }
        let out = String(data: pipe.fileHandleForReading.readDataToEndOfFile(), encoding: .utf8) ?? ""
        let path = out.split(separator: "\n").last.map(String.init)?.trimmingCharacters(in: .whitespaces) ?? ""
        guard path.hasPrefix("/"), FileManager.default.isExecutableFile(atPath: path) else { return nil }
        return URL(fileURLWithPath: path)
    }
}
