import XCTest
@testable import HydroBuddy

final class NotificationScheduleTests: XCTestCase {

    private func profile(wake: Int, sleep: Int) -> Profile {
        var p = Profile()
        p.wakeMinutes = wake
        p.sleepMinutes = sleep
        return p
    }

    func testSlotsStayInsideTheWakingWindow() {
        let p = profile(wake: 7 * 60, sleep: 23 * 60)
        let slots = NotificationManager.slots(profile: p, intervalMinutes: 90, limit: 32)
        XCTAssertFalse(slots.isEmpty)
        for slot in slots {
            XCTAssertGreaterThan(slot, p.wakeMinutes, "nothing before waking")
            XCTAssertLessThanOrEqual(slot, p.sleepMinutes - 60, "nothing in the last hour before bed")
        }
    }

    func testSlotsRespectTheInterval() {
        let slots = NotificationManager.slots(profile: profile(wake: 360, sleep: 1380),
                                              intervalMinutes: 120, limit: 32)
        for (a, b) in zip(slots, slots.dropFirst()) {
            XCTAssertEqual(b - a, 120)
        }
    }

    func testSlotCountIsCappedBelowTheSystemLimit() {
        let slots = NotificationManager.slots(profile: profile(wake: 0, sleep: 23 * 60 + 59),
                                              intervalMinutes: 15, limit: 32)
        XCTAssertLessThanOrEqual(slots.count, 32, "iOS allows 64 pending requests in total")
    }

    func testOvernightScheduleWrapsPastMidnight() {
        let slots = NotificationManager.slots(profile: profile(wake: 22 * 60, sleep: 6 * 60),
                                              intervalMinutes: 120, limit: 32)
        XCTAssertFalse(slots.isEmpty)
        XCTAssertTrue(slots.allSatisfy { (0..<1440).contains($0) }, "slots must be valid clock times")
        XCTAssertTrue(slots.contains { $0 < 6 * 60 }, "an overnight schedule should reach into the morning")
    }

    func testNoSlotsWhenThereIsNoRoom() {
        XCTAssertTrue(NotificationManager.slots(profile: profile(wake: 8 * 60, sleep: 8 * 60 + 30),
                                                intervalMinutes: 90, limit: 32).isEmpty)
    }
}
