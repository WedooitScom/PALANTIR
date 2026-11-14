import Foundation

/// Locations and settings shared by the whole app.
enum AppPaths {
    /// Port of the local map server. 4777 in production; `LOTR_APP_PORT=xxxx` or `--port xxxx`
    /// (debug/testing) points the app at another one without touching the real server.
    static let port: Int = {
        let args = CommandLine.arguments
        if let i = args.firstIndex(of: "--port"), i + 1 < args.count, let p = Int(args[i + 1]), p > 0 { return p }
        if let v = ProcessInfo.processInfo.environment["LOTR_APP_PORT"], let p = Int(v), p > 0 { return p }
        return 4777
    }()

    static var baseURL: URL { URL(string: "http://127.0.0.1:\(port)")! }
    static func url(_ path: String) -> URL { URL(string: "http://127.0.0.1:\(port)\(path)")! }

    /// Embedded copy of the Node project: Contents/Resources/app.
    static var appResources: URL {
        Bundle.main.resourceURL!.appendingPathComponent("app", isDirectory: true)
    }

    /// ~/Library/Application Support/TerreDuMilieu (events, server log, stable hook script).
    static var supportDir: URL {
        let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first!
        let dir = base.appendingPathComponent("TerreDuMilieu", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir
    }

    static var serverLog: URL { supportDir.appendingPathComponent("server.log") }
}
