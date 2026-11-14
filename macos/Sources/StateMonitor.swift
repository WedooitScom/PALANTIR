import Foundation

/// What the native side needs to know about an agent (subset of the server's agent object).
struct AgentInfo {
    let id: String
    let kind: String
    let project: String
    let status: String
    let waitingMessage: String?
    let waitingSince: Double
    let demo: Bool

    init?(_ d: [String: Any]) {
        guard let id = d["id"] as? String else { return nil }
        self.id = id
        kind = d["kind"] as? String ?? "session"
        project = d["project"] as? String ?? ""
        status = d["status"] as? String ?? "idle"
        demo = d["demo"] as? Bool ?? false
        if let w = d["waiting"] as? [String: Any] {
            waitingMessage = w["message"] as? String ?? ""
            waitingSince = (w["since"] as? NSNumber)?.doubleValue ?? 0
        } else {
            waitingMessage = nil
            waitingSince = 0
        }
    }

    var isWaiting: Bool { status == "waiting" }
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
        case "agent":
            guard let a = AgentInfo(obj) else { return }
            agents[a.id] = a
            checkWaiting([a])
        case "remove":
            if let id = obj["id"] as? String { agents.removeValue(forKey: id) }
        case "demo":
            demo = obj["on"] as? Bool ?? demo
        default:
            return // log / fx: nothing to do natively
        }
        onChange?()
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
