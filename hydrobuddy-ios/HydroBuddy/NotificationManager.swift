import Foundation
import UserNotifications

/// Interval reminders inside the waking window.
///
/// iOS has no "every 90 minutes but only while I'm awake" trigger, so the
/// window is expanded into individual daily calendar triggers. They fire with
/// the app closed, and nothing is scheduled between bed time and wake time.
@MainActor
final class NotificationManager: ObservableObject {

    @Published private(set) var authorized = false
    @Published private(set) var scheduledCount = 0

    /// iOS keeps at most 64 pending requests per app; stay well under.
    private let maxRequests = 32
    private let identifierPrefix = "hydrobuddy.slot."
    private let center = UNUserNotificationCenter.current()

    func refreshAuthorization() async {
        let settings = await center.notificationSettings()
        authorized = settings.authorizationStatus == .authorized || settings.authorizationStatus == .provisional
    }

    @discardableResult
    func requestAuthorization() async -> Bool {
        do {
            authorized = try await center.requestAuthorization(options: [.alert, .sound, .badge])
        } catch {
            authorized = false
        }
        return authorized
    }

    /// Minutes-after-midnight slots between waking and an hour before bed.
    nonisolated static func slots(profile: Profile, intervalMinutes: Int, limit: Int) -> [Int] {
        let interval = max(15, intervalMinutes)
        let wake = profile.wakeMinutes
        var sleep = profile.sleepMinutes
        if sleep <= wake { sleep += 24 * 60 }
        let last = sleep - 60
        guard last > wake else { return [] }

        var result: [Int] = []
        var t = wake + interval
        while t <= last && result.count < limit {
            result.append(t % (24 * 60))
            t += interval
        }
        return result
    }

    func reschedule(for state: AppState) async {
        await cancelAll()
        await refreshAuthorization()
        guard state.reminders.enabled, authorized else { return }

        let coach = state.coach
        let pool = (coach.lines[.behind] ?? []) + (coach.lines[.ontrack] ?? [])
        let chaos = state.vibe == .feral ? coach.feralSignatures + ChaosChorus.all : []
        let times = Self.slots(profile: state.profile, intervalMinutes: state.reminders.intervalMinutes,
                               limit: maxRequests)

        for (index, minutes) in times.enumerated() {
            let content = UNMutableNotificationContent()
            content.title = "\(coach.emoji) \(coach.name)"
            var body = pool.randomElement() ?? "Time for a glass of water."
            if let extra = chaos.randomElement() { body += " " + extra }
            content.body = body
            content.sound = .default
            content.interruptionLevel = .passive
            content.threadIdentifier = "hydrobuddy"

            var components = DateComponents()
            components.hour = minutes / 60
            components.minute = minutes % 60

            let request = UNNotificationRequest(
                identifier: "\(identifierPrefix)\(index)",
                content: content,
                trigger: UNCalendarNotificationTrigger(dateMatching: components, repeats: true)
            )
            do { try await center.add(request) } catch { continue }
        }
        scheduledCount = await center.pendingNotificationRequests().count
    }

    func cancelAll() async {
        let pending = await center.pendingNotificationRequests()
            .map(\.identifier)
            .filter { $0.hasPrefix(identifierPrefix) }
        center.removePendingNotificationRequests(withIdentifiers: pending)
        scheduledCount = 0
    }

    /// Fires roughly five seconds out so the user can background the app and
    /// see what a real reminder looks like.
    func sendTestNudge(state: AppState) async {
        await refreshAuthorization()
        let coach = state.coach
        let content = UNMutableNotificationContent()
        content.title = "\(coach.emoji) \(coach.name)"
        var rng = SystemRandomNumberGenerator()
        let message = CoachEngine.message(state: state, today: HydrationEngine.dayKey(), rng: &rng)
        content.body = message.text + (message.chaos.map { " " + $0 } ?? "")
        content.sound = .default
        let request = UNNotificationRequest(
            identifier: "hydrobuddy.test",
            content: content,
            trigger: UNTimeIntervalNotificationTrigger(timeInterval: 5, repeats: false)
        )
        try? await center.add(request)
    }
}
