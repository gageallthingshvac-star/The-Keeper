import Foundation

// MARK: - Drinks

struct DrinkType: Identifiable, Hashable, Codable {
    let id: String
    let name: String
    let emoji: String
    /// Share of the volume that counts toward the hydration target.
    let factor: Double
    let isAlcohol: Bool

    static func named(_ id: String) -> DrinkType {
        all.first { $0.id == id } ?? all[0]
    }
}

struct DrinkEntry: Identifiable, Hashable, Codable {
    let id: UUID
    let date: Date
    let typeID: String
    /// Volume actually drunk, in millilitres.
    let milliliters: Double
    /// Volume after the drink's hydration factor, in millilitres.
    let effectiveMilliliters: Double
    /// Identifier of the matching Apple Health sample, when one was written.
    var healthSampleID: UUID?

    var type: DrinkType { DrinkType.named(typeID) }

    init(id: UUID = UUID(), date: Date = .now, type: DrinkType, milliliters: Double, healthSampleID: UUID? = nil) {
        self.id = id
        self.date = date
        self.typeID = type.id
        self.milliliters = milliliters
        self.effectiveMilliliters = (milliliters * type.factor).rounded()
        self.healthSampleID = healthSampleID
    }
}

// MARK: - Coaches

enum Intent: String, CaseIterable, Codable {
    case welcome, behind, ontrack, almost, done, over, comeback
}

struct Coach: Identifiable, Hashable {
    let id: String
    let name: String
    let species: String
    let emoji: String
    let accentHex: String
    let vibe: String
    let blurb: String
    let lines: [Intent: [String]]
    /// Coach-specific chaos lines, used only in Feral vibe.
    let feralSignatures: [String]

    var title: String { "\(name) the \(species)" }

    static func named(_ id: String) -> Coach {
        all.first { $0.id == id } ?? all[0]
    }
}

enum Vibe: String, CaseIterable, Codable {
    case standard, feral

    var label: String { self == .standard ? "🙂 Standard" : "😈 Feral" }
}

// MARK: - Profile

enum Units: String, CaseIterable, Codable {
    case oz, ml

    var short: String { rawValue }
    var weightUnit: String { self == .oz ? "lb" : "kg" }
    var label: String { self == .oz ? "Ounces" : "Millilitres" }
}

enum Sex: String, CaseIterable, Codable {
    case female, male, other

    var label: String {
        switch self {
        case .female: return "Female"
        case .male: return "Male"
        case .other: return "Prefer not to say / other"
        }
    }
}

enum Climate: String, CaseIterable, Codable {
    case cool, temperate, warm, hot

    var label: String {
        switch self {
        case .cool: return "Cool or air-conditioned"
        case .temperate: return "Temperate"
        case .warm: return "Warm"
        case .hot: return "Hot or humid"
        }
    }
}

enum LifeStage: String, CaseIterable, Codable {
    case none, pregnant, nursing

    var label: String {
        switch self {
        case .none: return "None of these"
        case .pregnant: return "Pregnant"
        case .nursing: return "Breastfeeding"
        }
    }
}

struct Profile: Codable, Hashable {
    /// Expressed in the active unit system: pounds for `.oz`, kilograms for `.ml`.
    var weight: Double = 160
    var age: Int = 30
    var sex: Sex = .female
    var activityMinutes: Int = 20
    var climate: Climate = .temperate
    var lifeStage: LifeStage = .none
    /// Minutes after midnight.
    var wakeMinutes: Int = 7 * 60
    var sleepMinutes: Int = 22 * 60 + 30
}

// MARK: - Settings

struct PsychSettings: Codable, Hashable {
    var enabled = false
    var techniques: [String: Bool] = [
        "streak": true, "loss": false, "ifthen": true, "tiny": true, "selfproof": true,
        "selfcompassion": true, "bundle": false, "cue": true, "progress": true
    ]
    var plan = ""
    var bundle = ""

    func isOn(_ id: String) -> Bool { techniques[id] ?? false }
}

struct ReminderSettings: Codable, Hashable {
    var enabled = false
    var intervalMinutes = 90
}

struct HealthSettings: Codable, Hashable {
    /// Mirror logged drinks into Apple Health as dietary water.
    var syncEnabled = false
}

// MARK: - Persisted state

struct AppState: Codable, Hashable {
    static let currentSchema = 1

    var schema = AppState.currentSchema
    var onboarded = false
    var units: Units = .oz
    var vibe: Vibe = .standard
    var coachID = "otter"
    var selectedDrinkID = "water"
    var profile = Profile()
    var presetsOz: [Int] = [8, 12, 16, 20]
    var presetsMl: [Int] = [200, 330, 500, 750]
    var goalOverrideMilliliters: Double?
    var psych = PsychSettings()
    var reminders = ReminderSettings()
    var health = HealthSettings()
    /// Day key ("yyyy-MM-dd") to that day's entries.
    var log: [String: [DrinkEntry]] = [:]

    var coach: Coach { Coach.named(coachID) }
    var selectedDrink: DrinkType { DrinkType.named(selectedDrinkID) }
    var presets: [Int] {
        get { units == .oz ? presetsOz : presetsMl }
        set { if units == .oz { presetsOz = newValue } else { presetsMl = newValue } }
    }
}
