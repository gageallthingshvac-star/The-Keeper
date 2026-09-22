import XCTest
@testable import HydroBuddy

@MainActor
final class StoreTests: XCTestCase {

    private var url: URL!

    override func setUp() async throws {
        url = URL.temporaryDirectory.appendingPathComponent("hydrobuddy-test-\(UUID().uuidString).json")
    }

    override func tearDown() async throws {
        try? FileManager.default.removeItem(at: url)
    }

    func testLoggingAccumulatesEffectiveVolume() {
        let store = Store(fileURL: url)
        store.log(DrinkType.named("water"), millilitres: 500)
        store.log(DrinkType.named("coffee"), millilitres: 200)
        XCTAssertEqual(store.todayTotal, 500 + 170, accuracy: 0.5, "coffee counts at 85%")
        XCTAssertEqual(store.todayEntries.count, 2)
    }

    func testLoggingClampsAbsurdAmounts() {
        let store = Store(fileURL: url)
        store.log(DrinkType.named("water"), millilitres: 99_000)
        XCTAssertEqual(store.todayEntries.first?.milliliters, 3000)
        store.log(DrinkType.named("water"), millilitres: 1)
        XCTAssertEqual(store.todayEntries.first?.milliliters, 10)
    }

    func testUndoRemovesTheMostRecentEntryOnly() {
        let store = Store(fileURL: url)
        store.log(DrinkType.named("water"), millilitres: 300)
        store.log(DrinkType.named("tea"), millilitres: 200)
        store.undoLast()
        XCTAssertEqual(store.todayEntries.count, 1)
        XCTAssertEqual(store.todayEntries.first?.typeID, "water")
    }

    func testStatePersistsAcrossLaunches() {
        let first = Store(fileURL: url)
        first.setCoach("goose")
        first.setVibe(.feral)
        first.log(DrinkType.named("water"), millilitres: 750)
        first.saveNow()

        let second = Store(fileURL: url)
        XCTAssertEqual(second.state.coachID, "goose")
        XCTAssertEqual(second.state.vibe, .feral)
        XCTAssertEqual(second.todayTotal, 750, accuracy: 0.5)
    }

    func testCorruptStateFallsBackToDefaultsInsteadOfCrashing() throws {
        try Data("not json".utf8).write(to: url)
        let store = Store(fileURL: url)
        XCTAssertFalse(store.state.onboarded)
        XCTAssertEqual(store.state.coachID, "otter")
    }

    func testSwitchingUnitsConvertsBodyWeight() {
        let store = Store(fileURL: url)
        store.edit { $0.profile.weight = 180 }
        store.setUnits(.ml)
        XCTAssertEqual(store.state.profile.weight, 82, accuracy: 1, "pounds to kilograms")
        store.setUnits(.oz)
        XCTAssertEqual(store.state.profile.weight, 181, accuracy: 2, "and back again")
    }

    func testGoalNudgesAreClamped() {
        let store = Store(fileURL: url)
        for _ in 0..<50 { store.nudgeGoal(by: 1000) }
        XCTAssertLessThanOrEqual(store.goal, 6000)
        for _ in 0..<80 { store.nudgeGoal(by: -1000) }
        XCTAssertGreaterThanOrEqual(store.goal, 800)
        store.useEstimatedGoal()
        XCTAssertNil(store.state.goalOverrideMilliliters)
    }

    func testResetClearsEverythingIncludingDisk() {
        let store = Store(fileURL: url)
        store.log(DrinkType.named("water"), millilitres: 500)
        store.setCoach("cat")
        store.resetEverything()
        XCTAssertTrue(store.state.log.isEmpty)
        XCTAssertEqual(store.state.coachID, "otter")
        XCTAssertEqual(Store(fileURL: url).state.log.count, 0)
    }

    func testExportIsValidJSONContainingTheLog() throws {
        let store = Store(fileURL: url)
        store.log(DrinkType.named("juice"), millilitres: 250)
        let data = try XCTUnwrap(store.exportJSON())
        let object = try JSONSerialization.jsonObject(with: data) as? [String: Any]
        XCTAssertNotNil(object?["log"])
        XCTAssertNotNil(object?["profile"])
    }
}
