import Foundation

/// Every number the app shows comes from here. Pure functions only: no UI, no
/// storage, no clock beyond what is passed in — so all of it is unit-testable.
enum HydrationEngine {

    static let millilitresPerOunce = 29.5735

    // MARK: - Units

    static func toDisplay(_ millilitres: Double, units: Units) -> Double {
        units == .oz ? millilitres / millilitresPerOunce : millilitres
    }

    static func toMillilitres(_ value: Double, units: Units) -> Double {
        units == .oz ? value * millilitresPerOunce : value
    }

    /// Rounded display number: whole ounces, or millilitres to the nearest 5.
    static func displayNumber(_ millilitres: Double, units: Units) -> Int {
        let v = toDisplay(millilitres, units: units)
        return units == .oz ? Int(v.rounded()) : Int((v / 5).rounded()) * 5
    }

    static func format(_ millilitres: Double, units: Units) -> String {
        "\(displayNumber(millilitres, units: units)) \(units.short)"
    }

    /// Nudge step for the manual target adjustment.
    static func stepMilliliters(units: Units) -> Double {
        units == .oz ? 8 * millilitresPerOunce : 250
    }

    /// The "just take one sip" amount used by the tiny-first-step technique.
    static func smallSipMilliliters(units: Units) -> Double {
        units == .oz ? 6 * millilitresPerOunce : 200
    }

    // MARK: - Target estimate

    struct GoalBreakdown: Equatable {
        var base = 0.0
        var age = 0.0
        var sex = 0.0
        var activity = 0.0
        var climate = 0.0
        var lifeStage = 0.0
        var food = 0.0
        var total = 0.0
    }

    /// Daily fluid *to drink*, in millilitres. Body size drives the baseline;
    /// age, sex, exercise, climate and life stage adjust it; the share that
    /// arrives via food is subtracted so the number is drinkable volume.
    static func estimate(profile: Profile, units: Units) -> GoalBreakdown {
        var kg = units == .oz ? profile.weight * 0.453592 : profile.weight
        if !(kg > 0) { kg = 70 }
        kg = min(max(kg, 25), 320)

        var b = GoalBreakdown()
        b.base = kg * 33                                     // ~33 ml per kg
        b.age = profile.age >= 65 ? -b.base * 0.06 : (profile.age <= 17 ? b.base * 0.04 : 0)
        b.sex = profile.sex == .male ? b.base * 0.04 : (profile.sex == .female ? -b.base * 0.02 : 0)
        b.activity = min(600, Double(max(0, profile.activityMinutes)) / 30 * 350)

        switch profile.climate {
        case .hot: b.climate = 550
        case .warm: b.climate = 300
        case .cool: b.climate = -100
        case .temperate: b.climate = 0
        }
        switch profile.lifeStage {
        case .pregnant: b.lifeStage = 300
        case .nursing: b.lifeStage = 700
        case .none: b.lifeStage = 0
        }

        let subtotal = b.base + b.age + b.sex + b.activity + b.climate + b.lifeStage
        b.food = -subtotal * 0.18                            // ~a fifth of daily fluid comes from food
        let clamped = min(max(subtotal + b.food, 1200), 5000)
        b.total = ((clamped / 10).rounded() * 10)
        return b
    }

    static func goalMilliliters(state: AppState) -> Double {
        state.goalOverrideMilliliters ?? estimate(profile: state.profile, units: state.units).total
    }

    // MARK: - Day keys

    static func dayKey(_ date: Date = .now, calendar: Calendar = .current) -> String {
        let c = calendar.dateComponents([.year, .month, .day], from: date)
        return String(format: "%04d-%02d-%02d", c.year ?? 0, c.month ?? 0, c.day ?? 0)
    }

    static func date(fromDayKey key: String, calendar: Calendar = .current) -> Date? {
        let parts = key.split(separator: "-").compactMap { Int($0) }
        guard parts.count == 3 else { return nil }
        var c = DateComponents()
        c.year = parts[0]; c.month = parts[1]; c.day = parts[2]
        return calendar.date(from: c)
    }

    static func shiftDayKey(_ key: String, by days: Int, calendar: Calendar = .current) -> String {
        guard let d = date(fromDayKey: key, calendar: calendar),
              let shifted = calendar.date(byAdding: .day, value: days, to: d) else { return key }
        return dayKey(shifted, calendar: calendar)
    }

    static func lastDayKeys(_ count: Int, endingAt key: String, calendar: Calendar = .current) -> [String] {
        (0..<count).reversed().map { shiftDayKey(key, by: -$0, calendar: calendar) }
    }

    // MARK: - Totals

    static func entries(_ log: [String: [DrinkEntry]], on key: String) -> [DrinkEntry] {
        log[key] ?? []
    }

    /// Hydration-adjusted total for a day.
    static func total(_ log: [String: [DrinkEntry]], on key: String) -> Double {
        entries(log, on: key).reduce(0) { $0 + $1.effectiveMilliliters }
    }

    /// Raw volume drunk, before hydration factors.
    static func rawVolume(_ log: [String: [DrinkEntry]], on key: String) -> Double {
        entries(log, on: key).reduce(0) { $0 + $1.milliliters }
    }

    /// A day counts as met at 98% of target — near enough is met.
    static func metGoal(_ log: [String: [DrinkEntry]], on key: String, goal: Double) -> Bool {
        !entries(log, on: key).isEmpty && total(log, on: key) >= goal * 0.98
    }

    static func currentStreak(_ log: [String: [DrinkEntry]], goal: Double, today: String,
                              calendar: Calendar = .current) -> Int {
        var key = today
        if !metGoal(log, on: key, goal: goal) { key = shiftDayKey(key, by: -1, calendar: calendar) }
        var n = 0
        while metGoal(log, on: key, goal: goal) {
            n += 1
            let previous = shiftDayKey(key, by: -1, calendar: calendar)
            if previous == key { break }   // unparseable key: stop rather than spin
            key = previous
        }
        return n
    }

    static func bestStreak(_ log: [String: [DrinkEntry]], goal: Double, today: String,
                           calendar: Calendar = .current) -> Int {
        guard var key = log.keys.sorted().first else { return 0 }
        var best = 0, run = 0
        while key <= today {
            if metGoal(log, on: key, goal: goal) {
                run += 1
                best = max(best, run)
            } else {
                run = 0
            }
            let next = shiftDayKey(key, by: 1, calendar: calendar)
            if next == key { break }       // unparseable key: stop rather than spin
            key = next
        }
        return best
    }

    struct TrackedStats: Equatable {
        var loggedDays = 0
        var metDays = 0
        var average = 0.0
    }

    static func trackedStats(_ log: [String: [DrinkEntry]], days: Int, goal: Double, today: String,
                             calendar: Calendar = .current) -> TrackedStats {
        var s = TrackedStats()
        var sum = 0.0
        for key in lastDayKeys(days, endingAt: today, calendar: calendar) where !entries(log, on: key).isEmpty {
            s.loggedDays += 1
            sum += total(log, on: key)
            if metGoal(log, on: key, goal: goal) { s.metDays += 1 }
        }
        s.average = s.loggedDays > 0 ? sum / Double(s.loggedDays) : 0
        return s
    }

    // MARK: - Pace

    struct Pace: Equatable {
        /// Fraction of the drinking window elapsed, 0...1.
        var through = 0.0
        /// Where the total should be by now, in millilitres.
        var expected = 0.0
        /// Actual minus expected. Negative means behind.
        var delta = 0.0
    }

    /// Expected progress for this time of day, across the waking window.
    /// Intake is not expected in the last hour before bed.
    static func pace(total: Double, goal: Double, profile: Profile, nowMinutes: Int) -> Pace {
        let wake = profile.wakeMinutes
        var sleep = profile.sleepMinutes
        if sleep <= wake { sleep = wake + 16 * 60 }
        let span = Double(max(60, (sleep - 60) - wake))
        var p = Pace()
        p.through = min(max(Double(nowMinutes - wake) / span, 0), 1)
        p.expected = goal * p.through
        p.delta = total - p.expected
        return p
    }

    static func isAwake(profile: Profile, nowMinutes: Int) -> Bool {
        let wake = profile.wakeMinutes, sleep = profile.sleepMinutes
        return sleep > wake ? (nowMinutes >= wake && nowMinutes <= sleep)
                            : (nowMinutes >= wake || nowMinutes <= sleep)
    }

    static func minutes(from date: Date, calendar: Calendar = .current) -> Int {
        let c = calendar.dateComponents([.hour, .minute], from: date)
        return (c.hour ?? 0) * 60 + (c.minute ?? 0)
    }

    // MARK: - Intent

    static func intent(state: AppState, today: String, calendar: Calendar = .current) -> Intent {
        guard state.onboarded else { return .welcome }
        let goal = goalMilliliters(state: state)
        let ratio = goal > 0 ? total(state.log, on: today) / goal : 0
        if ratio >= 1.6 { return .over }
        if ratio >= 1 { return .done }
        if ratio >= 0.8 { return .almost }
        let yesterday = shiftDayKey(today, by: -1, calendar: calendar)
        let hasHistory = !state.log.isEmpty
        if hasHistory && entries(state.log, on: today).isEmpty && entries(state.log, on: yesterday).isEmpty {
            return .comeback
        }
        return ratio >= 0.4 ? .ontrack : .behind
    }
}
