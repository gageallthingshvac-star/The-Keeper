import Foundation
import SwiftUI

/// Owns the persisted state and every mutation of it.
///
/// Writes are debounced and the file is written atomically, so a burst of
/// slider drags costs one disk write rather than one per frame.
@MainActor
final class Store: ObservableObject {

    @Published private(set) var state: AppState
    @Published private(set) var todayKey: String
    @Published var lastMessage: CoachMessage?

    let health = HealthKitManager()
    let notifications = NotificationManager()

    private var saveTask: Task<Void, Never>?
    private let fileURL: URL
    private let calendar: Calendar

    // MARK: - Lifecycle

    init(fileURL: URL? = nil, calendar: Calendar = .current) {
        self.calendar = calendar
        self.fileURL = fileURL ?? Store.defaultFileURL()
        self.state = Store.loadState(from: self.fileURL)
        self.todayKey = HydrationEngine.dayKey(.now, calendar: calendar)
        health.syncEnabled = state.health.syncEnabled
    }

    static func defaultFileURL() -> URL {
        let dir = (try? FileManager.default.url(for: .applicationSupportDirectory, in: .userDomainMask,
                                                appropriateFor: nil, create: true))
            ?? URL.temporaryDirectory
        return dir.appendingPathComponent("hydrobuddy-state.json")
    }

    private static func loadState(from url: URL) -> AppState {
        guard let data = try? Data(contentsOf: url),
              let decoded = try? JSONDecoder().decode(AppState.self, from: data) else { return AppState() }
        return decoded
    }

    // MARK: - Persistence

    /// Mutate state and schedule a debounced write.
    func edit(_ change: (inout AppState) -> Void) {
        change(&state)
        scheduleSave()
    }

    private func scheduleSave() {
        saveTask?.cancel()
        saveTask = Task { [weak self] in
            try? await Task.sleep(for: .milliseconds(400))
            guard !Task.isCancelled else { return }
            self?.saveNow()
        }
    }

    func saveNow() {
        saveTask?.cancel()
        saveTask = nil
        guard let data = try? JSONEncoder().encode(state) else { return }
        try? data.write(to: fileURL, options: .atomic)
    }

    func exportJSON() -> Data? {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        encoder.dateEncodingStrategy = .iso8601
        return try? encoder.encode(state)
    }

    // MARK: - Derived values

    var goal: Double { HydrationEngine.goalMilliliters(state: state) }
    var todayTotal: Double { HydrationEngine.total(state.log, on: todayKey) }
    var todayEntries: [DrinkEntry] {
        HydrationEngine.entries(state.log, on: todayKey).sorted { $0.date > $1.date }
    }
    var progress: Double { goal > 0 ? todayTotal / goal : 0 }
    var streak: Int { HydrationEngine.currentStreak(state.log, goal: goal, today: todayKey, calendar: calendar) }
    var hadAlcoholToday: Bool { todayEntries.contains { $0.type.isAlcohol } }
    var pace: HydrationEngine.Pace {
        HydrationEngine.pace(total: todayTotal, goal: goal, profile: state.profile,
                             nowMinutes: HydrationEngine.minutes(from: .now, calendar: calendar))
    }

    func format(_ millilitres: Double) -> String {
        HydrationEngine.format(millilitres, units: state.units)
    }

    // MARK: - Logging

    @discardableResult
    func log(_ type: DrinkType, millilitres: Double) -> DrinkEntry {
        let clamped = min(max(millilitres.rounded(), 10), 3000)
        let entry = DrinkEntry(date: .now, type: type, milliliters: clamped)
        edit { $0.log[todayKey, default: []].append(entry) }
        refreshMessage()
        mirrorToHealth(entry)
        return entry
    }

    func remove(_ entry: DrinkEntry) {
        edit { state in
            for (key, entries) in state.log where entries.contains(where: { $0.id == entry.id }) {
                state.log[key]?.removeAll { $0.id == entry.id }
            }
        }
        refreshMessage()
        if let sample = entry.healthSampleID {
            Task { await health.deleteSample(id: sample) }
        }
    }

    func undoLast() {
        guard let last = todayEntries.first else { return }
        remove(last)
    }

    /// Apple Health mirroring is optional and per-entry: a failure never blocks
    /// the log, it just leaves the entry unmirrored.
    private func mirrorToHealth(_ entry: DrinkEntry) {
        guard state.health.syncEnabled else { return }
        Task { [weak self] in
            guard let self else { return }
            guard let sampleID = await health.saveWater(millilitres: entry.milliliters, date: entry.date) else { return }
            edit { state in
                for (key, entries) in state.log {
                    if let idx = entries.firstIndex(where: { $0.id == entry.id }) {
                        state.log[key]?[idx].healthSampleID = sampleID
                    }
                }
            }
        }
    }

    // MARK: - Settings

    func setCoach(_ id: String) {
        edit { $0.coachID = id }
        refreshMessage()
        rescheduleReminders()
    }

    func setVibe(_ vibe: Vibe) {
        edit { $0.vibe = vibe }
        refreshMessage()
        rescheduleReminders()
    }

    func setUnits(_ units: Units) {
        guard units != state.units else { return }
        edit { state in
            // Convert the stored body weight so the estimate stays honest.
            state.profile.weight = units == .ml ? (state.profile.weight * 0.453592).rounded()
                                                : (state.profile.weight / 0.453592).rounded()
            state.units = units
        }
    }

    func nudgeGoal(by delta: Double) {
        let next = min(max(goal + delta, 800), 6000)
        edit { $0.goalOverrideMilliliters = next }
        refreshMessage()
    }

    func useEstimatedGoal() {
        edit { $0.goalOverrideMilliliters = nil }
        refreshMessage()
    }

    func completeSetup() {
        edit {
            $0.onboarded = true
            $0.goalOverrideMilliliters = nil
        }
        refreshMessage()
        rescheduleReminders()
    }

    func setHealthSync(_ on: Bool) async {
        if on {
            let granted = await health.requestAuthorization()
            guard granted else {
                edit { $0.health.syncEnabled = false }
                health.syncEnabled = false
                return
            }
        }
        edit { $0.health.syncEnabled = on }
        health.syncEnabled = on
    }

    func setRemindersEnabled(_ on: Bool) async {
        if on {
            let granted = await notifications.requestAuthorization()
            guard granted else {
                edit { $0.reminders.enabled = false }
                return
            }
        }
        edit { $0.reminders.enabled = on }
        rescheduleReminders()
    }

    func rescheduleReminders() {
        Task { await notifications.reschedule(for: state) }
    }

    func resetEverything() {
        saveTask?.cancel()
        state = AppState()
        lastMessage = nil
        saveNow()
        Task { await notifications.cancelAll() }
    }

    // MARK: - Coach message

    func refreshMessage() {
        lastMessage = CoachEngine.message(state: state, today: todayKey, calendar: calendar)
    }

    /// Called on foreground and by the day-rollover timer.
    func refreshForNewDayIfNeeded() {
        let key = HydrationEngine.dayKey(.now, calendar: calendar)
        if key != todayKey {
            todayKey = key
            refreshMessage()
        }
    }
}
