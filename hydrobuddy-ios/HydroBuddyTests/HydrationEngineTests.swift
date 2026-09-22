import XCTest
@testable import HydroBuddy

final class HydrationEngineTests: XCTestCase {

    private func profile(weightLb: Double = 160) -> Profile {
        var p = Profile()
        p.weight = weightLb
        return p
    }

    func testEstimateStaysInsideSafeBounds() {
        var tiny = profile(weightLb: 60)
        tiny.activityMinutes = 0
        tiny.climate = .cool
        XCTAssertGreaterThanOrEqual(HydrationEngine.estimate(profile: tiny, units: .oz).total, 1200)

        var huge = profile(weightLb: 690)
        huge.activityMinutes = 600
        huge.climate = .hot
        huge.lifeStage = .nursing
        XCTAssertLessThanOrEqual(HydrationEngine.estimate(profile: huge, units: .oz).total, 5000)
    }

    func testEstimateSubtractsFluidFromFood() {
        let p = profile()
        let b = HydrationEngine.estimate(profile: p, units: .oz)
        XCTAssertLessThan(b.food, 0, "food adjustment must reduce the amount you have to drink")
        let subtotal = b.base + b.age + b.sex + b.activity + b.climate + b.lifeStage
        XCTAssertEqual(b.food, -subtotal * 0.18, accuracy: 1e-9)
    }

    func testZeroWeightFallsBackInsteadOfProducingZeroGoal() {
        var p = profile(weightLb: 0)
        p.activityMinutes = 0
        let b = HydrationEngine.estimate(profile: p, units: .oz)
        XCTAssertGreaterThan(b.total, 1200)
    }

    func testExerciseContributionIsCapped() {
        var light = profile(); light.activityMinutes = 30
        var extreme = profile(); extreme.activityMinutes = 600
        XCTAssertEqual(HydrationEngine.estimate(profile: light, units: .oz).activity, 350, accuracy: 1e-9)
        XCTAssertEqual(HydrationEngine.estimate(profile: extreme, units: .oz).activity, 600, accuracy: 1e-9)
    }

    func testUnitRoundTrip() {
        for ml in stride(from: 50.0, through: 3000.0, by: 137.0) {
            let oz = HydrationEngine.toDisplay(ml, units: .oz)
            XCTAssertEqual(HydrationEngine.toMillilitres(oz, units: .oz), ml, accuracy: 1e-9)
        }
    }

    func testMillilitreDisplayRoundsToFive() {
        XCTAssertEqual(HydrationEngine.displayNumber(333, units: .ml), 335)
        XCTAssertEqual(HydrationEngine.displayNumber(332, units: .ml), 330)
    }

    func testDayKeyArithmeticCrossesMonthBoundaries() {
        XCTAssertEqual(HydrationEngine.shiftDayKey("2026-03-01", by: -1), "2026-02-28")
        XCTAssertEqual(HydrationEngine.shiftDayKey("2024-03-01", by: -1), "2024-02-29", "leap year")
        XCTAssertEqual(HydrationEngine.shiftDayKey("2025-12-31", by: 1), "2026-01-01")
        XCTAssertEqual(HydrationEngine.lastDayKeys(3, endingAt: "2026-01-02"),
                       ["2025-12-31", "2026-01-01", "2026-01-02"])
    }

    func testGoalIsMetAtNinetyEightPercent() {
        let today = "2026-05-05"
        let water = DrinkType.named("water")
        var log: [String: [DrinkEntry]] = [:]
        log[today] = [DrinkEntry(type: water, milliliters: 1960)]
        XCTAssertTrue(HydrationEngine.metGoal(log, on: today, goal: 2000), "98% counts as met")
        log[today] = [DrinkEntry(type: water, milliliters: 1959)]
        XCTAssertFalse(HydrationEngine.metGoal(log, on: today, goal: 2000))
    }

    func testEmptyDayNeverCountsAsMet() {
        XCTAssertFalse(HydrationEngine.metGoal([:], on: "2026-05-05", goal: 0))
    }

    func testHydrationFactorsReduceEffectiveVolume() {
        let beer = DrinkType.named("beer")
        let entry = DrinkEntry(type: beer, milliliters: 500)
        XCTAssertEqual(entry.effectiveMilliliters, 200, "beer counts at 40%")
        XCTAssertTrue(beer.isAlcohol)
        XCTAssertEqual(DrinkEntry(type: DrinkType.named("water"), milliliters: 500).effectiveMilliliters, 500)
    }

    func testStreakIgnoresTodayUntilItIsMet() {
        let today = HydrationEngine.dayKey()
        let yesterday = HydrationEngine.shiftDayKey(today, by: -1)
        let water = DrinkType.named("water")
        var log: [String: [DrinkEntry]] = [yesterday: [DrinkEntry(type: water, milliliters: 2000)]]
        XCTAssertEqual(HydrationEngine.currentStreak(log, goal: 2000, today: today), 1,
                       "an unfinished today must not break yesterday's streak")
        log[today] = [DrinkEntry(type: water, milliliters: 2000)]
        XCTAssertEqual(HydrationEngine.currentStreak(log, goal: 2000, today: today), 2)
    }

    func testPaceIsClampedToTheWakingWindow() {
        var p = Profile()
        p.wakeMinutes = 7 * 60
        p.sleepMinutes = 23 * 60
        let before = HydrationEngine.pace(total: 0, goal: 2000, profile: p, nowMinutes: 6 * 60)
        XCTAssertEqual(before.through, 0, "nothing is expected before you wake up")
        let after = HydrationEngine.pace(total: 0, goal: 2000, profile: p, nowMinutes: 23 * 60 + 30)
        XCTAssertEqual(after.through, 1, accuracy: 1e-9)
        XCTAssertEqual(after.delta, -2000, accuracy: 1e-9)
    }

    func testPaceHandlesOvernightSchedules() {
        var p = Profile()
        p.wakeMinutes = 22 * 60
        p.sleepMinutes = 6 * 60
        let pace = HydrationEngine.pace(total: 500, goal: 2000, profile: p, nowMinutes: 23 * 60)
        XCTAssertGreaterThan(pace.through, 0)
        XCTAssertLessThan(pace.through, 1)
    }

    func testAwakeWindowWrapsMidnight() {
        var p = Profile()
        p.wakeMinutes = 22 * 60
        p.sleepMinutes = 6 * 60
        XCTAssertTrue(HydrationEngine.isAwake(profile: p, nowMinutes: 23 * 60))
        XCTAssertTrue(HydrationEngine.isAwake(profile: p, nowMinutes: 2 * 60))
        XCTAssertFalse(HydrationEngine.isAwake(profile: p, nowMinutes: 12 * 60))
    }

    func testIntentProgression() {
        let today = HydrationEngine.dayKey()
        var state = AppState()
        XCTAssertEqual(HydrationEngine.intent(state: state, today: today), .welcome, "before setup")

        state.onboarded = true
        state.goalOverrideMilliliters = 1000
        XCTAssertEqual(HydrationEngine.intent(state: state, today: today), .behind)

        func log(_ ml: Double) {
            state.log[today] = [DrinkEntry(type: DrinkType.named("water"), milliliters: ml)]
        }
        log(500);  XCTAssertEqual(HydrationEngine.intent(state: state, today: today), .ontrack)
        log(850);  XCTAssertEqual(HydrationEngine.intent(state: state, today: today), .almost)
        log(1000); XCTAssertEqual(HydrationEngine.intent(state: state, today: today), .done)
        log(1700); XCTAssertEqual(HydrationEngine.intent(state: state, today: today), .over)
    }

    func testComebackOnlyAfterRealHistory() {
        let today = HydrationEngine.dayKey()
        var state = AppState()
        state.onboarded = true
        state.goalOverrideMilliliters = 2000
        XCTAssertEqual(HydrationEngine.intent(state: state, today: today), .behind,
                       "a brand-new user is not 'coming back'")

        state.log[HydrationEngine.shiftDayKey(today, by: -4)] =
            [DrinkEntry(type: DrinkType.named("water"), milliliters: 2000)]
        XCTAssertEqual(HydrationEngine.intent(state: state, today: today), .comeback)
    }
}
