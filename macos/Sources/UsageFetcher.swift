import Foundation

/// 5 h / 7 day limits straight from Anthropic, for when no terminal session runs the status line
/// (the desktop app does not). Uses the Claude Code login token **only while it is still valid**:
/// it is read from the login Keychain item "Claude Code-credentials" through /usr/bin/security
/// (the tool Claude Code itself uses, so macOS does not prompt), never refreshed, never written
/// anywhere, never logged, and only sent to api.anthropic.com. The two percentages are then posted
/// to the local map server as a status-line-like payload (no token, no session id).
/// The usage endpoint is not publicly documented: any failure just leaves the gauges to the status line.
final class UsageFetcher {
    var log: ((String) -> Void)?

    private let every: TimeInterval = 180
    private var timer: Timer?
    private var lastState = ""
    private let session: URLSession = {
        let cfg = URLSessionConfiguration.ephemeral // no cookies, no cache
        cfg.timeoutIntervalForRequest = 10
        cfg.urlCache = nil
        return URLSession(configuration: cfg)
    }()

    func start() {
        DispatchQueue.main.asyncAfter(deadline: .now() + 5) { [weak self] in self?.tick() }
        timer = Timer.scheduledTimer(withTimeInterval: every, repeats: true) { [weak self] _ in self?.tick() }
    }

    private func report(_ state: String) {
        guard state != lastState else { return }
        lastState = state
        log?("Limites Anthropic : \(state)")
    }

    private func tick() {
        DispatchQueue.global(qos: .utility).async { [weak self] in
            guard let self else { return }
            guard let token = Self.validToken() else {
                DispatchQueue.main.async { self.report("jeton absent ou expiré, on attend une session terminal") }
                return
            }
            self.fetch(token)
        }
    }

    /// The access token if it is still valid for at least a minute, nil otherwise.
    private static func validToken() -> String? {
        let p = Process()
        p.executableURL = URL(fileURLWithPath: "/usr/bin/security")
        p.arguments = ["find-generic-password", "-s", "Claude Code-credentials", "-w"]
        let out = Pipe()
        p.standardOutput = out
        p.standardError = FileHandle.nullDevice
        do { try p.run() } catch { return nil }
        let data = out.fileHandleForReading.readDataToEndOfFile()
        p.waitUntilExit()
        guard p.terminationStatus == 0,
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let oauth = json["claudeAiOauth"] as? [String: Any],
              let token = oauth["accessToken"] as? String, !token.isEmpty,
              let expires = (oauth["expiresAt"] as? NSNumber)?.doubleValue
        else { return nil }
        let expiresSec = expires > 1e11 ? expires / 1000 : expires
        return expiresSec > Date().timeIntervalSince1970 + 60 ? token : nil
    }

    private func fetch(_ token: String) {
        var req = URLRequest(url: URL(string: "https://api.anthropic.com/api/oauth/usage")!)
        req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        req.setValue("oauth-2025-04-20", forHTTPHeaderField: "anthropic-beta")
        req.setValue("palantir-map", forHTTPHeaderField: "User-Agent")
        session.dataTask(with: req) { [weak self] data, resp, _ in
            guard let self else { return }
            let code = (resp as? HTTPURLResponse)?.statusCode ?? 0
            guard code == 200, let data,
                  let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
            else {
                DispatchQueue.main.async { self.report(code == 0 ? "réseau indisponible" : "réponse HTTP \(code)") }
                return
            }
            var limits: [String: Any] = [:]
            for key in ["five_hour", "seven_day"] {
                guard let w = json[key] as? [String: Any], let u = (w["utilization"] as? NSNumber)?.doubleValue else { continue }
                var out: [String: Any] = ["used_percentage": u]
                if let r = w["resets_at"] as? String { out["resets_at"] = r }
                limits[key] = out
            }
            guard !limits.isEmpty else {
                DispatchQueue.main.async { self.report("format de réponse inattendu") }
                return
            }
            self.post(["rate_limits": limits])
        }.resume()
    }

    private func post(_ payload: [String: Any]) {
        guard let body = try? JSONSerialization.data(withJSONObject: payload) else { return }
        var req = URLRequest(url: AppPaths.url("/statusline"))
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = body
        URLSession.shared.dataTask(with: req) { [weak self] _, resp, _ in
            let code = (resp as? HTTPURLResponse)?.statusCode ?? 0
            DispatchQueue.main.async { self?.report(code == 200 ? "à jour" : "serveur local indisponible") }
        }.resume()
    }
}
