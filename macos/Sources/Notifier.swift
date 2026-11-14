import AppKit
import UserNotifications

/// macOS notifications: an agent waiting for an answer, the 5 h limit running low, and a test
/// notification (📣 button of the map, « Tester les notifications » in the menu). Clicking one opens the map,
/// or (« attend ta réponse », by default) goes to the agent's session.
final class Notifier: NSObject, UNUserNotificationCenterDelegate {
    var onOpen: (() -> Void)?
    /// Click on a « attend ta réponse » notification (agent id); falls back to onOpen when nil.
    var onOpenAgent: ((String) -> Void)?
    private var center: UNUserNotificationCenter { UNUserNotificationCenter.current() }

    func setUp() {
        center.delegate = self
        // Asks once (first launch); macOS remembers the answer afterwards.
        center.requestAuthorization(options: [.alert, .sound, .badge]) { _, _ in }
    }

    func notifyWaiting(_ agent: AgentInfo) {
        let content = UNMutableNotificationContent()
        let project = agent.project.isEmpty ? "Une compagnie" : agent.project
        content.title = "🔥 \(project) attend ta réponse"
        let message = agent.waitingMessage ?? ""
        content.body = message.isEmpty ? "Les feux d'alarme sont allumés." : message
        content.sound = .default
        content.threadIdentifier = agent.id
        content.userInfo = ["agentId": agent.id]
        let id = "waiting-\(agent.id)-\(Int(agent.waitingSince))"
        center.add(UNNotificationRequest(identifier: id, content: content, trigger: nil))
    }

    /// 5 h limit crossing 80 % / 95 %.
    func notifyLimit(level: Int, limit: LimitInfo) {
        let content = UNMutableNotificationContent()
        content.title = level >= 95 ? "⚠️ Les lembas sont presque épuisés" : "⚠️ Les lembas s'épuisent"
        var body = "\(Int(limit.pct.rounded())) % de la limite d'usage de Claude sur 5 h."
        if let r = limit.resetsAt, let left = UsageFormat.countdown(to: r) { body += " Reset dans \(left)." }
        content.body = body
        content.sound = .default
        content.threadIdentifier = "usage"
        let id = "limit-\(level)-\(Int(limit.resetsAt ?? 0))"
        center.add(UNNotificationRequest(identifier: id, content: content, trigger: nil))
    }

    // MARK: - authorization / test

    static func name(_ s: UNAuthorizationStatus) -> String {
        switch s {
        case .notDetermined: return "notDetermined"
        case .denied: return "denied"
        case .authorized: return "authorized"
        case .provisional: return "provisional"
        @unknown default: return "unknown"
        }
    }

    /// Current authorization, on the main queue.
    func status(_ completion: @escaping (String) -> Void) {
        center.getNotificationSettings { settings in
            let st = Notifier.name(settings.authorizationStatus)
            DispatchQueue.main.async { completion(st) }
        }
    }

    /// What the 📣 button does: ask if never asked, explain + open System Settings if denied,
    /// send a test notification if allowed. Completion (main queue): final state, test sent.
    func requestOrTest(_ completion: @escaping (String, Bool) -> Void) {
        center.getNotificationSettings { [weak self] settings in
            guard let self else { return }
            switch settings.authorizationStatus {
            case .notDetermined:
                self.center.requestAuthorization(options: [.alert, .sound, .badge]) { granted, _ in
                    if granted { self.sendTest() }
                    self.status { st in completion(st, granted) }
                }
            case .denied:
                DispatchQueue.main.async {
                    self.openSettings()
                    completion("denied", false)
                }
            default:
                self.sendTest()
                let st = Notifier.name(settings.authorizationStatus)
                DispatchQueue.main.async { completion(st, true) }
            }
        }
    }

    func sendTest() {
        let content = UNMutableNotificationContent()
        content.title = "🔥 Test — les feux d'alarme fonctionnent"
        content.body = "Tu seras prévenu ici quand un agent attend ta réponse."
        content.sound = .default
        center.add(UNNotificationRequest(identifier: "test-\(Date().timeIntervalSince1970)", content: content, trigger: nil))
    }

    /// System Settings > Notifications (macOS 13+), on this app's page when supported.
    func openSettings() {
        let id = Bundle.main.bundleIdentifier ?? "com.lotragent.map"
        let candidates = [
            "x-apple.systempreferences:com.apple.Notifications-Settings.extension?id=\(id)",
            "x-apple.systempreferences:com.apple.Notifications-Settings.extension",
            "x-apple.systempreferences:com.apple.preference.notifications",
        ]
        for s in candidates {
            if let url = URL(string: s), NSWorkspace.shared.open(url) { return }
        }
    }

    /// Show banners even while the app is frontmost.
    func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification,
                                withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void) {
        completionHandler([.banner, .sound, .list])
    }

    func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse,
                                withCompletionHandler completionHandler: @escaping () -> Void) {
        let agentId = response.notification.request.content.userInfo["agentId"] as? String
        DispatchQueue.main.async {
            if let agentId, let open = self.onOpenAgent { open(agentId) } else { self.onOpen?() }
        }
        completionHandler()
    }
}

/// French formatting shared by the menu and the notifications.
enum UsageFormat {
    /// "1 h 26", "12 min", "3 j 4 h" until an epoch (seconds); nil when past.
    static func countdown(to epoch: Double) -> String? {
        let s = Int((epoch - Date().timeIntervalSince1970).rounded())
        if s <= 0 { return nil }
        if s < 60 { return "\(s) s" }
        let m = s / 60
        if m < 60 { return "\(m) min" }
        let h = m / 60
        if h < 24 { return String(format: "%d h %02d", h, m % 60) }
        return "\(h / 24) j \(h % 24) h"
    }

    /// 950 · 1,2 k · 3,4 M · 1,1 G
    static func tokens(_ n: Double) -> String {
        func dec(_ v: Double, _ d: Int) -> String { String(format: "%.\(d)f", v).replacingOccurrences(of: ".", with: ",") }
        if n < 1000 { return String(Int(n.rounded())) }
        if n < 1e6 { return "\(dec(n / 1e3, n < 1e4 ? 1 : 0)) k" }
        if n < 1e9 { return "\(dec(n / 1e6, n < 1e7 ? 1 : 0)) M" }
        return "\(dec(n / 1e9, 1)) G"
    }

    static func usd(_ v: Double) -> String {
        String(format: "%.2f $", v).replacingOccurrences(of: ".", with: ",")
    }
}
