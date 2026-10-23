import Foundation
import HealthKit

/// Apple Health mirroring for logged drinks. Entirely optional: if permission
/// is refused or unavailable, logging still works and nothing is written.
@MainActor
final class HealthKitManager: ObservableObject {

    @Published private(set) var isAvailable = HKHealthStore.isHealthDataAvailable()
    @Published private(set) var canWrite = false
    @Published private(set) var status = "Not connected."
    /// Mirrored from AppState so the store can read it without a round trip.
    var syncEnabled = false

    private let store = HKHealthStore()
    private var waterType: HKQuantityType? { HKQuantityType.quantityType(forIdentifier: .dietaryWater) }

    init() { refreshStatus() }

    /// HealthKit deliberately hides read permission, so only the share status
    /// is meaningful — and it is the one that decides whether writes land.
    func refreshStatus() {
        guard isAvailable, let waterType else {
            canWrite = false
            status = "Apple Health isn't available on this device."
            return
        }
        switch store.authorizationStatus(for: waterType) {
        case .sharingAuthorized:
            canWrite = true
            status = "Connected — new drinks are written as dietary water."
        case .sharingDenied:
            canWrite = false
            status = "Permission denied. Turn Water back on in Health › Sharing › Apps."
        case .notDetermined:
            canWrite = false
            status = "Not connected."
        @unknown default:
            canWrite = false
            status = "Not connected."
        }
    }

    @discardableResult
    func requestAuthorization() async -> Bool {
        guard isAvailable, let waterType else {
            status = "Apple Health isn't available on this device."
            return false
        }
        do {
            try await store.requestAuthorization(toShare: [waterType], read: [waterType])
        } catch {
            status = "Apple Health request failed: \(error.localizedDescription)"
            refreshStatus()
            return false
        }
        // The call succeeding only means the sheet was shown. Ask for the real answer.
        refreshStatus()
        return canWrite
    }

    /// Writes one drink and returns the sample's UUID so the entry can be
    /// unwritten later if the user deletes it here.
    func saveWater(millilitres: Double, date: Date) async -> UUID? {
        guard syncEnabled, canWrite, millilitres > 0, let waterType else { return nil }
        let quantity = HKQuantity(unit: .literUnit(with: .milli), doubleValue: millilitres)
        let sample = HKQuantitySample(type: waterType, quantity: quantity, start: date, end: date)
        do {
            try await store.save(sample)
            return sample.uuid
        } catch {
            status = "Couldn't write to Apple Health: \(error.localizedDescription)"
            return nil
        }
    }

    /// Removes a previously written sample. Only samples this app wrote are
    /// visible to it, so this cannot touch another app's data.
    func deleteSample(id: UUID) async {
        guard canWrite, let waterType else { return }
        let predicate = HKQuery.predicateForObject(with: id)
        let samples: [HKSample] = await withCheckedContinuation { continuation in
            let query = HKSampleQuery(sampleType: waterType, predicate: predicate,
                                      limit: 1, sortDescriptors: nil) { _, results, _ in
                continuation.resume(returning: results ?? [])
            }
            store.execute(query)
        }
        guard let sample = samples.first else { return }
        try? await store.delete(sample)
    }
}
