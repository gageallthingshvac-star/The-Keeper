import Foundation

/// One behaviour-change technique. Opt-in, individually switchable, and always
/// named in the message it produces — nothing is applied silently.
struct Technique: Identifiable, Hashable {
    let id: String
    let name: String
    let why: String
    let generate: (CoachEngine.Context) -> String?

    static func == (a: Technique, b: Technique) -> Bool { a.id == b.id }
    func hash(into hasher: inout Hasher) { hasher.combine(id) }
}

struct CoachMessage: Equatable {
    var coach: Coach
    var intent: Intent
    /// The coach's line, plus the technique sentence when one applies.
    var text: String
    /// Feral-vibe chaos line, shown under the main text.
    var chaos: String?
    /// Name of the technique used, when one was.
    var techniqueName: String?
    /// Plain-language reason that technique works.
    var techniqueWhy: String?

    static func == (a: CoachMessage, b: CoachMessage) -> Bool {
        a.coach.id == b.coach.id && a.intent == b.intent && a.text == b.text &&
        a.chaos == b.chaos && a.techniqueName == b.techniqueName
    }
}

enum CoachEngine {

    /// Everything a technique is allowed to know. All of it comes from the
    /// user's own logged data — no invented statistics about other people.
    struct Context {
        var intent: Intent
        var percent: Int
        var streak: Int
        var bestStreak: Int
        var metDays: Int
        var loggedDays: Int
        var plan: String
        var bundle: String
        var remaining: String
        var smallSip: String
        var hour: Int
        var cue: String
    }

    static let cues = [
        "every time you stand up from your desk",
        "after every bathroom trip",
        "whenever you unlock your phone on the hour",
        "before each meal",
        "every time you check the time"
    ]

    static let techniques: [Technique] = [
        Technique(id: "streak", name: "Streak keeping",
                  why: "Habit chains: an unbroken run becomes its own reason to continue.") { c in
            if c.streak >= 2 && c.intent != .done { return "You're on a \(c.streak)-day run. Today keeps it alive." }
            if c.streak >= 2 && c.intent == .done { return "That's \(c.streak) days in a row. The chain holds." }
            if c.intent == .done { return "Day one of a new chain. Tomorrow makes it a streak." }
            return nil
        },
        Technique(id: "loss", name: "Loss framing",
                  why: "People fight harder to keep what they already have than to gain something new.") { c in
            if c.streak >= 3 && c.intent != .done {
                return "Stopping here costs you a \(c.streak)-day streak you already earned."
            }
            if c.percent >= 60 && c.percent < 100 {
                return "You've already done \(c.percent)% of the work. Leaving it unfinished wastes all of it."
            }
            return nil
        },
        Technique(id: "ifthen", name: "If–then plan",
                  why: "Deciding the exact cue and action in advance roughly doubles follow-through.") { c in
            if !c.plan.isEmpty { return "Your plan: \(c.plan)" }
            if c.intent == .behind || c.intent == .comeback {
                return "Write one if–then plan in the Coach tab. \"After X, I drink a glass\" beats willpower every time."
            }
            return nil
        },
        Technique(id: "tiny", name: "Tiny first step",
                  why: "Shrink the ask past the point of refusal. Starting is the hard part, not finishing.") { c in
            if c.intent == .behind || c.intent == .comeback {
                return "Forget the target. Just the next \(c.smallSip). That's the only decision on the table."
            }
            if c.intent == .almost { return "Only \(c.remaining) left. That's one glass, not a project." }
            return nil
        },
        Technique(id: "selfproof", name: "Your own evidence",
                  why: "Your own past behaviour persuades you more than any statistic about strangers.") { c in
            if c.intent == .done || c.intent == .over {
                return c.metDays >= 2 ? "That's \(c.metDays) of your last \(c.loggedDays) tracked days on target." : nil
            }
            if c.loggedDays >= 4 {
                return "You've hit target on \(c.metDays) of your last \(c.loggedDays) tracked days. You can obviously do this one."
            }
            if c.bestStreak >= 3 { return "Your best run is \(c.bestStreak) days. You've already proved it's doable." }
            return nil
        },
        Technique(id: "selfcompassion", name: "Self-compassion",
                  why: "Self-criticism predicts quitting. Self-kindness after a lapse predicts resuming.") { c in
            if c.intent == .comeback { return "A missed day is data, not a verdict. Nothing to make up for — just start." }
            if c.intent == .behind && c.hour >= 18 { return "Late start, not a failed day. Whatever you drink now still counts." }
            return nil
        },
        Technique(id: "bundle", name: "Temptation bundling",
                  why: "Pair the habit with something you already enjoy and it borrows that reward.") { c in
            c.bundle.isEmpty ? nil : "Bundle it: \(c.bundle)"
        },
        Technique(id: "cue", name: "Habit stacking",
                  why: "Anchor a new habit to an existing routine and you stop needing to remember it.") { c in
            (c.intent == .behind || c.intent == .ontrack) ? "Anchor it: one glass \(c.cue)." : nil
        },
        Technique(id: "progress", name: "Progress framing",
                  why: "Visible partial progress raises motivation to close the remaining gap.") { c in
            (c.percent >= 25 && c.percent < 100)
                ? "You're \(c.percent)% there. The gap is smaller than the part you've already done."
                : nil
        }
    ]

    static func technique(_ id: String) -> Technique? { techniques.first { $0.id == id } }

    // MARK: - Message building

    static func message<G: RandomNumberGenerator>(state: AppState, today: String, now: Date = .now,
                                                  calendar: Calendar = .current, rng: inout G) -> CoachMessage {
        let coach = state.coach
        let intent = HydrationEngine.intent(state: state, today: today, calendar: calendar)
        let goal = HydrationEngine.goalMilliliters(state: state)
        let total = HydrationEngine.total(state.log, on: today)
        let percent = min(999, Int(((goal > 0 ? total / goal : 0) * 100).rounded()))
        let stats = HydrationEngine.trackedStats(state.log, days: 30, goal: goal, today: today, calendar: calendar)

        let context = Context(
            intent: intent,
            percent: percent,
            streak: HydrationEngine.currentStreak(state.log, goal: goal, today: today, calendar: calendar),
            bestStreak: HydrationEngine.bestStreak(state.log, goal: goal, today: today, calendar: calendar),
            metDays: stats.metDays,
            loggedDays: stats.loggedDays,
            plan: state.psych.plan.trimmingCharacters(in: .whitespacesAndNewlines),
            bundle: state.psych.bundle.trimmingCharacters(in: .whitespacesAndNewlines),
            remaining: HydrationEngine.format(max(0, goal - total), units: state.units),
            smallSip: HydrationEngine.format(HydrationEngine.smallSipMilliliters(units: state.units), units: state.units),
            hour: calendar.component(.hour, from: now),
            cue: cues.randomElement(using: &rng) ?? cues[0]
        )

        let pool = coach.lines[intent] ?? coach.lines[.ontrack] ?? []
        var text = pool.randomElement(using: &rng) ?? ""
        var name: String?
        var why: String?

        if state.psych.enabled {
            var applicable: [(Technique, String)] = []
            for t in techniques where state.psych.isOn(t.id) {
                if let line = t.generate(context) { applicable.append((t, line)) }
            }
            if let (chosen, line) = applicable.randomElement(using: &rng) {
                text += " " + line
                name = chosen.name
                why = chosen.why
            }
        }

        var chaos: String?
        if state.vibe == .feral {
            let hadAlcohol = HydrationEngine.entries(state.log, on: today).contains { $0.type.isAlcohol }
            if hadAlcohol, intent != .done, Double.random(in: 0..<1, using: &rng) < 0.5 {
                chaos = "You drank something fun earlier. Water is the tax. Pay it."
            } else if !coach.feralSignatures.isEmpty, Double.random(in: 0..<1, using: &rng) < 0.45 {
                chaos = coach.feralSignatures.randomElement(using: &rng)
            } else {
                chaos = ChaosChorus.all.randomElement(using: &rng)
            }
        }

        return CoachMessage(coach: coach, intent: intent, text: text, chaos: chaos,
                            techniqueName: name, techniqueWhy: why)
    }

    static func message(state: AppState, today: String, now: Date = .now, calendar: Calendar = .current) -> CoachMessage {
        var rng = SystemRandomNumberGenerator()
        return message(state: state, today: today, now: now, calendar: calendar, rng: &rng)
    }
}
