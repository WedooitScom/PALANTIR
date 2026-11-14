import Foundation

/// What the native side needs to know about an agent (subset of the server's agent object).
struct AgentInfo {
    let id: String
    let kind: String
    /// Id of the session this agent belongs to (itself for a session).
    let sessionId: String
    let project: String
    let cwd: String
    let status: String
    let waitingMessage: String?
    /// The same in French (gloss of an invented language).
    let waitingMessageFr: String?
    let waitingSince: Double
    let demo: Bool
    /// Where the session runs (sessions only), validated again here: see SessionOrigin.
    let origin: SessionOrigin?

    init?(_ d: [String: Any]) {
        guard let id = d["id"] as? String else { return nil }
        self.id = id
        kind = d["kind"] as? String ?? "session"
        sessionId = d["sessionId"] as? String ?? id
        project = d["project"] as? String ?? ""
        cwd = d["cwd"] as? String ?? ""
        status = d["status"] as? String ?? "idle"
        demo = d["demo"] as? Bool ?? false
        origin = SessionOrigin(d["origin"])
        if let w = d["waiting"] as? [String: Any] {
            waitingMessage = AgentInfo.waitText(w)
            waitingMessageFr = AgentInfo.waitText(w, lang: "fr")
            waitingSince = (w["since"] as? NSNumber)?.doubleValue ?? 0
        } else {
            waitingMessage = nil
            waitingMessageFr = nil
            waitingSince = 0
        }
    }

    var isWaiting: Bool { status == "waiting" }

    /// The waiting message in the app's language when it is one of the known messages ({ key, params }
    /// in waiting.i), else the French text sent by the server (a question typed by Claude, a demo text).
    static func waitText(_ w: [String: Any], lang: String? = nil) -> String {
        let fallback = w["message"] as? String ?? ""
        guard let i = w["i"] as? [String: Any], let key = i["key"] as? String, key.hasPrefix("wait."),
              L10n.fr[key] != nil else { return fallback }
        var args: [String: String] = [:]
        for (k, v) in i["params"] as? [String: Any] ?? [:] { if let s = v as? String { args[k] = String(s.prefix(80)) } }
        return L10n.tl(lang ?? L10n.lang, key, args)
    }
}

/// One usage limit window (5 h or 7 days): used % and reset time (epoch seconds).
struct LimitInfo: Equatable {
    let pct: Double
    let resetsAt: Double?

    init?(_ v: Any?) {
        guard let d = v as? [String: Any], let p = (d["pct"] as? NSNumber)?.doubleValue else { return nil }
        pct = p
        resetsAt = (d["resetsAt"] as? NSNumber)?.doubleValue
    }

    /// The window is over (the server has not received a newer reading yet).
    var expired: Bool { resetsAt.map { $0 <= Date().timeIntervalSince1970 } ?? false }
}

/// Claude usage as sent by the server (`usage` in the snapshot and `usage` events).
/// Real values win; demo values are only used when there are no real ones.
struct UsageInfo {
    var five: LimitInfo?
    var seven: LimitInfo?
    var todayTokens: Double?
    var todayCost: Double?
    var demo = false

    init?(_ v: Any?) {
        guard let d = v as? [String: Any] else { return nil }
        five = LimitInfo(d["five"])
        seven = LimitInfo(d["seven"])
        demo = d["demo"] as? Bool ?? false
        if let today = d["today"] as? [String: Any] {
            todayTokens = ((today["tokens"] as? [String: Any])?["total"] as? NSNumber)?.doubleValue
            todayCost = (today["costUsd"] as? NSNumber)?.doubleValue
        }
        if five == nil && seven == nil && todayTokens == nil && todayCost == nil { return nil }
    }

    var hasLimits: Bool { five != nil || seven != nil }
}

/// Subscribes to /stream (Server-Sent Events) and keeps a live list of agents.
/// Reconnects automatically every 2 s while the server is unreachable.
final class StateMonitor: NSObject, URLSessionDataDelegate {
    private(set) var agents: [String: AgentInfo] = [:]
    private(set) var demo = false
    private(set) var connected = false

    /// Called on the main queue after every change.
    var onChange: (() -> Void)?
    /// Called on the main queue when an agent starts waiting (once per wait).
    var onNewWaiting: ((AgentInfo) -> Void)?
    /// Called on the main queue when the real 5 h limit crosses 80 % or 95 % (once per level and window).
    var onLimitCrossed: ((Int, LimitInfo) -> Void)?

    private(set) var realUsage: UsageInfo?
    private(set) var demoUsage: UsageInfo?
    /// What to display: limits from the real usage if any, otherwise from the demo.
    var usage: UsageInfo? {
        if let r = realUsage, r.hasLimits { return r }
        if let d = demoUsage, d.hasLimits { return d }
        return realUsage ?? demoUsage
    }
    private var limitWindow: Double?
    private var limitNotified = Set<Int>()
    private var limitPrimed = false
    static let limitLevels = [80, 95]

    private var session: URLSession!
    private var task: URLSessionDataTask?
    private var buffer = Data()
    private var notified = Set<String>()
    private var primed = false

    override init() {
        super.init()
        let cfg = URLSessionConfiguration.default
        cfg.timeoutIntervalForRequest = 60 // the server pings every 15 s
        cfg.timeoutIntervalForResource = 60 * 60 * 24 * 365
        cfg.requestCachePolicy = .reloadIgnoringLocalCacheData
        session = URLSession(configuration: cfg, delegate: self, delegateQueue: .main)
    }

    func start() {
        guard task == nil else { return }
        buffer = Data()
        var req = URLRequest(url: AppPaths.url("/stream"))
        req.setValue("text/event-stream", forHTTPHeaderField: "Accept")
        task = session.dataTask(with: req)
        task?.resume()
    }

    private func scheduleReconnect() {
        task = nil
        if connected {
            connected = false
            onChange?()
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + 2) { [weak self] in self?.start() }
    }

    var sessions: [AgentInfo] { agents.values.filter { $0.kind == "session" } }
    var activeCompanies: Int { sessions.filter { $0.status != "done" }.count }
    var codingCount: Int { agents.values.filter { $0.status == "coding" }.count }
    var waiting: [AgentInfo] {
        agents.values.filter { $0.isWaiting }.sorted { $0.waitingSince < $1.waitingSince }
    }

    func setDemo(_ on: Bool) {
        demo = on
        onChange?()
    }

    // MARK: - URLSessionDataDelegate

    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive response: URLResponse,
                    completionHandler: @escaping (URLSession.ResponseDisposition) -> Void) {
        guard (response as? HTTPURLResponse)?.statusCode == 200 else {
            completionHandler(.cancel)
            return
        }
        connected = true
        completionHandler(.allow)
    }

    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive data: Data) {
        buffer.append(data)
        let sep = Data("\n\n".utf8)
        while let r = buffer.range(of: sep) {
            let block = buffer.subdata(in: buffer.startIndex..<r.lowerBound)
            buffer.removeSubrange(buffer.startIndex..<r.upperBound)
            handleBlock(String(decoding: block, as: UTF8.self))
        }
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        scheduleReconnect()
    }

    // MARK: - SSE parsing

    private func handleBlock(_ block: String) {
        var event = "message"
        var dataLines: [String] = []
        for raw in block.split(separator: "\n", omittingEmptySubsequences: false) {
            let line = raw.hasSuffix("\r") ? String(raw.dropLast()) : String(raw)
            if line.hasPrefix(":") || line.isEmpty { continue }
            if line.hasPrefix("event:") {
                event = line.dropFirst(6).trimmingCharacters(in: .whitespaces)
            } else if line.hasPrefix("data:") {
                var v = String(line.dropFirst(5))
                if v.hasPrefix(" ") { v.removeFirst() }
                dataLines.append(v)
            }
        }
        guard !dataLines.isEmpty,
              let json = try? JSONSerialization.jsonObject(with: Data(dataLines.joined(separator: "\n").utf8)),
              let obj = json as? [String: Any] else { return }
        switch event {
        case "snapshot":
            var next: [String: AgentInfo] = [:]
            for d in obj["agents"] as? [[String: Any]] ?? [] {
                if let a = AgentInfo(d) { next[a.id] = a }
            }
            agents = next
            demo = obj["demo"] as? Bool ?? false
            checkWaiting(Array(next.values))
            primed = true
            applyUsage(obj["usage"])
        case "agent":
            guard let a = AgentInfo(obj) else { return }
            agents[a.id] = a
            checkWaiting([a])
        case "remove":
            if let id = obj["id"] as? String { agents.removeValue(forKey: id) }
        case "demo":
            demo = obj["on"] as? Bool ?? demo
        case "usage":
            applyUsage(obj)
        default:
            return // log / fx: nothing to do natively
        }
        onChange?()
    }

    private func applyUsage(_ v: Any?) {
        let d = v as? [String: Any]
        realUsage = UsageInfo(d?["real"])
        demoUsage = UsageInfo(d?["demo"])
        checkLimits(realUsage?.five)
    }

    /// 80 % / 95 % of the real 5 h limit, once per level and window. Levels already passed when the
    /// app first sees the window are not notified.
    private func checkLimits(_ five: LimitInfo?) {
        guard let five else { return }
        if let r = five.resetsAt {
            if let w = limitWindow, r > w + 120 {
                limitNotified.removeAll()
            }
            if limitWindow == nil || r > limitWindow! + 120 { limitWindow = r }
        }
        var crossed: Int?
        for level in StateMonitor.limitLevels where five.pct >= Double(level) {
            if limitNotified.insert(level).inserted { crossed = level }
        }
        if let level = crossed, limitPrimed { onLimitCrossed?(level, five) }
        limitPrimed = true
    }

    /// Notifies each wait once (keyed by agent + start time). The waits already present when the app
    /// first connects are shown in the menu but not notified.
    private func checkWaiting(_ list: [AgentInfo]) {
        for a in list where a.isWaiting {
            let key = "\(a.id)|\(a.waitingSince)"
            if notified.insert(key).inserted, primed { onNewWaiting?(a) }
        }
        if notified.count > 2000 {
            // Forget finished waits, keep the ones still in progress.
            notified = Set(agents.values.filter { $0.isWaiting }.map { "\($0.id)|\($0.waitingSince)" })
        }
    }
}
