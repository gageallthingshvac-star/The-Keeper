import XCTest
@testable import HydroBuddy

/// The Swift engine is a port of the JavaScript implementation in
/// `hydrobuddy.html`, which has browser test coverage. These vectors are
/// generated from that implementation (`tools/gen-vectors.mjs`), so any drift
/// between the two engines fails here rather than on someone's phone.
final class ParityVectorTests: XCTestCase {

    // MARK: - Vector decoding

    struct Vectors: Decodable {
        struct VProfile: Decodable {
            let weight: Double
            let age: Int
            let sex: String
            let activity: Int
            let climate: String
            let special: String
            let wakeMinutes: Int
            let sleepMinutes: Int

            var model: Profile {
                Profile(weight: weight,
                        age: age,
                        sex: Sex(rawValue: sex) ?? .other,
                        activityMinutes: activity,
                        climate: Climate(rawValue: climate) ?? .temperate,
                        lifeStage: LifeStage(rawValue: special) ?? LifeStage.none,
                        wakeMinutes: wakeMinutes,
                        sleepMinutes: sleepMinutes)
            }
        }
        struct Breakdown: Decodable {
            let base, age, sex, activity, climate, lifeStage, food, total: Double
        }
        struct EstimateCase: Decodable { let units: String; let profile: VProfile; let expected: Breakdown }
        struct FormatCase: Decodable { let millilitres: Double; let units: String; let expected: String }
        struct PaceExpectation: Decodable { let through, expected, delta: Double }
        struct PaceCase: Decodable {
            let wakeMinutes, sleepMinutes: Int
            let goal, total: Double
            let nowMinutes: Int
            let expected: PaceExpectation
        }
        struct Day: Decodable { let offset: Int; let millilitres: Double }
        struct StreakExpectation: Decodable {
            let currentStreak, bestStreak, loggedDays, metDays: Int
            let average: Double
            let intent: String
        }
        struct StreakCase: Decodable { let goal: Double; let days: [Day]; let expected: StreakExpectation }

        let estimates: [EstimateCase]
        let formats: [FormatCase]
        let paces: [PaceCase]
        let streaks: [StreakCase]
    }

    private static func load() throws -> Vectors {
        let bundle = Bundle(for: ParityVectorTests.self)
        let url = try XCTUnwrap(bundle.url(forResource: "parity-vectors", withExtension: "json"),
                                "parity-vectors.json is missing from the test target's resources")
        return try JSONDecoder().decode(Vectors.self, from: Data(contentsOf: url))
    }

    // MARK: - Tests

    func testGoalEstimateMatchesReferenceImplementation() throws {
        let vectors = try Self.load()
        XCTAssertGreaterThan(vectors.estimates.count, 50)
        for (index, c) in vectors.estimates.enumerated() {
            let units = Units(rawValue: c.units) ?? .oz
            let got = HydrationEngine.estimate(profile: c.profile.model, units: units)
            let label = "case \(index) (\(c.units), \(c.profile.weight))"
            XCTAssertEqual(got.base, c.expected.base, accuracy: 1e-6, "base, \(label)")
            XCTAssertEqual(got.age, c.expected.age, accuracy: 1e-6, "age, \(label)")
            XCTAssertEqual(got.sex, c.expected.sex, accuracy: 1e-6, "sex, \(label)")
            XCTAssertEqual(got.activity, c.expected.activity, accuracy: 1e-6, "activity, \(label)")
            XCTAssertEqual(got.climate, c.expected.climate, accuracy: 1e-6, "climate, \(label)")
            XCTAssertEqual(got.lifeStage, c.expected.lifeStage, accuracy: 1e-6, "life stage, \(label)")
            XCTAssertEqual(got.food, c.expected.food, accuracy: 1e-6, "food, \(label)")
            XCTAssertEqual(got.total, c.expected.total, accuracy: 1e-6, "total, \(label)")
        }
    }

    func testFormattingMatchesReferenceImplementation() throws {
        let vectors = try Self.load()
        for c in vectors.formats {
            let units = Units(rawValue: c.units) ?? .oz
            XCTAssertEqual(HydrationEngine.format(c.millilitres, units: units), c.expected,
                           "\(c.millilitres) ml in \(c.units)")
        }
    }

    func testPaceMatchesReferenceImplementation() throws {
        let vectors = try Self.load()
        for (index, c) in vectors.paces.enumerated() {
            var profile = Profile()
            profile.wakeMinutes = c.wakeMinutes
            profile.sleepMinutes = c.sleepMinutes
            let got = HydrationEngine.pace(total: c.total, goal: c.goal, profile: profile, nowMinutes: c.nowMinutes)
            XCTAssertEqual(got.through, c.expected.through, accuracy: 1e-6, "through, case \(index)")
            XCTAssertEqual(got.expected, c.expected.expected, accuracy: 1e-6, "expected, case \(index)")
            XCTAssertEqual(got.delta, c.expected.delta, accuracy: 1e-6, "delta, case \(index)")
        }
    }

    func testStreaksAndIntentMatchReferenceImplementation() throws {
        let vectors = try Self.load()
        let today = HydrationEngine.dayKey()
        for (index, c) in vectors.streaks.enumerated() {
            var state = AppState()
            state.onboarded = true
            state.units = .ml
            state.goalOverrideMilliliters = c.goal
            for day in c.days {
                let key = HydrationEngine.shiftDayKey(today, by: day.offset)
                state.log[key] = [DrinkEntry(date: .now, type: DrinkType.named("water"),
                                             milliliters: day.millilitres)]
            }
            let goal = HydrationEngine.goalMilliliters(state: state)
            let stats = HydrationEngine.trackedStats(state.log, days: 30, goal: goal, today: today)

            XCTAssertEqual(HydrationEngine.currentStreak(state.log, goal: goal, today: today),
                           c.expected.currentStreak, "current streak, case \(index)")
            XCTAssertEqual(HydrationEngine.bestStreak(state.log, goal: goal, today: today),
                           c.expected.bestStreak, "best streak, case \(index)")
            XCTAssertEqual(stats.loggedDays, c.expected.loggedDays, "logged days, case \(index)")
            XCTAssertEqual(stats.metDays, c.expected.metDays, "met days, case \(index)")
            XCTAssertEqual(stats.average, c.expected.average, accuracy: 1e-6, "average, case \(index)")
            XCTAssertEqual(HydrationEngine.intent(state: state, today: today).rawValue,
                           c.expected.intent, "intent, case \(index)")
        }
    }
}
