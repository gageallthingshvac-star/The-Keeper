import XCTest
@testable import HydroBuddy

/// A tiny SplitMix64 so message selection is deterministic under test.
struct SeededGenerator: RandomNumberGenerator {
    private var state: UInt64
    init(seed: UInt64) { state = seed }
    mutating func next() -> UInt64 {
        state &+= 0x9E3779B97F4A7C15
        var z = state
        z = (z ^ (z >> 30)) &* 0xBF58476D1CE4E5B9
        z = (z ^ (z >> 27)) &* 0x94D049BB133111EB
        return z ^ (z >> 31)
    }
}

final class CoachEngineTests: XCTestCase {

    private let today = HydrationEngine.dayKey()

    private func baseState() -> AppState {
        var s = AppState()
        s.onboarded = true
        s.goalOverrideMilliliters = 2000
        return s
    }

    func testEveryCoachHasLinesForEveryIntent() {
        XCTAssertEqual(Coach.all.count, 10)
        for coach in Coach.all {
            for intent in Intent.allCases {
                let lines = coach.lines[intent] ?? []
                XCTAssertFalse(lines.isEmpty, "\(coach.id) has no \(intent.rawValue) lines")
                XCTAssertFalse(lines.contains { $0.trimmingCharacters(in: .whitespaces).isEmpty },
                               "\(coach.id) has a blank \(intent.rawValue) line")
            }
            XCTAssertFalse(coach.feralSignatures.isEmpty, "\(coach.id) has no feral lines")
            XCTAssertFalse(coach.accentHex.isEmpty)
        }
        XCTAssertEqual(Set(Coach.all.map(\.id)).count, Coach.all.count, "coach ids must be unique")
    }

    func testTechniqueIDsMatchTheDefaultSettings() {
        let engineIDs = Set(CoachEngine.techniques.map(\.id))
        let settingsIDs = Set(PsychSettings().techniques.keys)
        XCTAssertEqual(engineIDs, settingsIDs,
                       "a technique with no switch can never be turned off, and vice versa")
    }

    func testMessageIsDeterministicForAGivenSeed() {
        let state = baseState()
        var a = SeededGenerator(seed: 42)
        var b = SeededGenerator(seed: 42)
        let first = CoachEngine.message(state: state, today: today, rng: &a)
        let second = CoachEngine.message(state: state, today: today, rng: &b)
        XCTAssertEqual(first, second)
    }

    func testMessageUsesTheSelectedCoachAndIntent() {
        var state = baseState()
        state.coachID = "goose"
        state.log[today] = [DrinkEntry(type: DrinkType.named("water"), milliliters: 2000)]
        var rng = SeededGenerator(seed: 7)
        let message = CoachEngine.message(state: state, today: today, rng: &rng)
        XCTAssertEqual(message.coach.id, "goose")
        XCTAssertEqual(message.intent, .done)
        XCTAssertTrue(Coach.named("goose").lines[.done]!.contains { message.text.hasPrefix($0) })
    }

    func testNoTechniqueLeaksWhenPsychologyIsOff() {
        var state = baseState()
        state.psych.enabled = false
        for seed in UInt64(0)..<50 {
            var rng = SeededGenerator(seed: seed)
            let message = CoachEngine.message(state: state, today: today, rng: &rng)
            XCTAssertNil(message.techniqueName, "techniques must stay off until opted in")
        }
    }

    func testEveryTechniqueSentenceIsLabelled() {
        var state = baseState()
        state.psych.enabled = true
        state.psych.plan = "After I sit down, I drink a glass."
        state.log[HydrationEngine.shiftDayKey(today, by: -1)] =
            [DrinkEntry(type: DrinkType.named("water"), milliliters: 2000)]

        var sawTechnique = false
        for seed in UInt64(0)..<80 {
            var rng = SeededGenerator(seed: seed)
            let message = CoachEngine.message(state: state, today: today, rng: &rng)
            if let name = message.techniqueName {
                sawTechnique = true
                XCTAssertNotNil(message.techniqueWhy, "\(name) must explain itself")
                XCTAssertTrue(CoachEngine.techniques.contains { $0.name == name })
            }
        }
        XCTAssertTrue(sawTechnique, "at least one technique should apply to a user who is behind")
    }

    func testDisabledTechniqueNeverAppears() {
        var state = baseState()
        state.psych.enabled = true
        state.psych.techniques = state.psych.techniques.mapValues { _ in false }
        state.psych.techniques["cue"] = true
        for seed in UInt64(0)..<40 {
            var rng = SeededGenerator(seed: seed)
            let message = CoachEngine.message(state: state, today: today, rng: &rng)
            if let name = message.techniqueName {
                XCTAssertEqual(name, "Habit stacking")
            }
        }
    }

    func testSelfProofOnlyCitesTheUsersOwnLoggedDays() {
        var state = baseState()
        state.psych.enabled = true
        // Four met days out of five tracked.
        for offset in 1...5 {
            let ml: Double = offset == 3 ? 500 : 2100
            state.log[HydrationEngine.shiftDayKey(today, by: -offset)] =
                [DrinkEntry(type: DrinkType.named("water"), milliliters: ml)]
        }
        let technique = CoachEngine.technique("selfproof")!
        let context = CoachEngine.Context(intent: .behind, percent: 10, streak: 0, bestStreak: 2,
                                          metDays: 4, loggedDays: 5, plan: "", bundle: "",
                                          remaining: "40 oz", smallSip: "6 oz", hour: 9, cue: "")
        XCTAssertEqual(technique.generate(context),
                       "You've hit target on 4 of your last 5 tracked days. You can obviously do this one.")
    }

    func testChaosLinesOnlyAppearInFeralVibe() {
        var state = baseState()
        state.vibe = .standard
        for seed in UInt64(0)..<30 {
            var rng = SeededGenerator(seed: seed)
            XCTAssertNil(CoachEngine.message(state: state, today: today, rng: &rng).chaos)
        }
        state.vibe = .feral
        for seed in UInt64(0)..<30 {
            var rng = SeededGenerator(seed: seed)
            let chaos = CoachEngine.message(state: state, today: today, rng: &rng).chaos
            XCTAssertNotNil(chaos)
            XCTAssertFalse(chaos!.isEmpty)
        }
    }

    func testAlcoholGetsCalledOutInFeralVibe() {
        var state = baseState()
        state.vibe = .feral
        state.log[today] = [DrinkEntry(type: DrinkType.named("beer"), milliliters: 500)]
        var sawTax = false
        for seed in UInt64(0)..<60 {
            var rng = SeededGenerator(seed: seed)
            if CoachEngine.message(state: state, today: today, rng: &rng).chaos?.contains("tax") == true {
                sawTax = true
            }
        }
        XCTAssertTrue(sawTax)
    }
}
