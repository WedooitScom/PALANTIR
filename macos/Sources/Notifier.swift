import AppKit
import UserNotifications

/// macOS notifications when an agent starts waiting for an answer. Clicking one opens the map.
final class Notifier: NSObject, UNUserNotificationCenterDelegate {
    var onOpen: (() -> Void)?
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
        let id = "waiting-\(agent.id)-\(Int(agent.waitingSince))"
        center.add(UNNotificationRequest(identifier: id, content: content, trigger: nil))
    }

    /// Show banners even while the app is frontmost.
    func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification,
                                withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void) {
        completionHandler([.banner, .sound, .list])
    }

    func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse,
                                withCompletionHandler completionHandler: @escaping () -> Void) {
        DispatchQueue.main.async { self.onOpen?() }
        completionHandler()
    }
}
