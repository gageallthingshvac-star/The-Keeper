import SwiftUI

struct SetupView: View {
    @EnvironmentObject private var store: Store
    @Environment(\.palette) private var palette
    @State private var presetDrafts: [String] = ["", "", "", ""]
    @State private var exportURL: URL?
    @State private var showResetConfirm = false

    private var state: AppState { store.state }

    private struct BreakdownRow: Identifiable {
        let label: String
        let amount: Double
        var emphasised = false
        var id: String { label }
    }

    private var profileBinding: Binding<Profile> {
        Binding(get: { store.state.profile },
                set: { value in store.edit { $0.profile = value } })
    }

    var body: some View {
        Page {
            unitsCard
            bodyCard
            targetCard
            containersCard
            remindersCard
            healthCard
            dataCard
            disclaimerCard
        }
        .onAppear(perform: syncDrafts)
        .onChange(of: state.units) { _, _ in syncDrafts() }
        .confirmationDialog("Burn it all down?", isPresented: $showResetConfirm, titleVisibility: .visible) {
            Button("Delete everything", role: .destructive) {
                store.resetEverything()
                syncDrafts()
                Haptics.warning()
            }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("Deletes your profile, coach, streak and every logged drink on this device. Apple Health entries already written stay in Health.")
        }
    }

    // MARK: - Cards

    private var unitsCard: some View {
        Card(title: "Units") {
            Picker("Units", selection: Binding(
                get: { state.units },
                set: { store.setUnits($0) })) {
                    ForEach(Units.allCases, id: \.self) { Text($0.label).tag($0) }
                }
                .pickerStyle(.segmented)
        }
    }

    private var bodyCard: some View {
        Card(title: "Your body & day", subtitle: "Stays on this device. Nobody's harvesting it.") {
            VStack(spacing: 12) {
                LabeledContent("Weight (\(state.units.weightUnit))") {
                    TextField("Weight", value: profileBinding.weight, format: .number.precision(.fractionLength(0)))
                        .keyboardType(.decimalPad)
                        .multilineTextAlignment(.trailing)
                        .frame(width: 90)
                }
                Divider().overlay(palette.line)
                Stepper("Age: \(state.profile.age)", value: profileBinding.age, in: 13...110)
                Divider().overlay(palette.line)
                Stepper("Exercise today: \(state.profile.activityMinutes) min",
                        value: profileBinding.activityMinutes, in: 0...600, step: 5)
            }

            VStack(spacing: 12) {
                Picker("Sex", selection: profileBinding.sex) {
                    ForEach(Sex.allCases, id: \.self) { Text($0.label).tag($0) }
                }
                Picker("Climate", selection: profileBinding.climate) {
                    ForEach(Climate.allCases, id: \.self) { Text($0.label).tag($0) }
                }
                Picker("Life stage", selection: profileBinding.lifeStage) {
                    ForEach(LifeStage.allCases, id: \.self) { Text($0.label).tag($0) }
                }
            }

            VStack(spacing: 12) {
                Divider().overlay(palette.line)
                DatePicker("Wake", selection: timeBinding(for: \.wakeMinutes), displayedComponents: .hourAndMinute)
                DatePicker("Bed", selection: timeBinding(for: \.sleepMinutes), displayedComponents: .hourAndMinute)
            }

            Button("Recalculate my target") {
                store.completeSetup()
                Haptics.success()
            }
            .buttonStyle(PillButtonStyle(prominent: true))
        }
    }

    private var targetCard: some View {
        let breakdown = HydrationEngine.estimate(profile: state.profile, units: state.units)
        let rows = [
            BreakdownRow(label: "Body weight baseline", amount: breakdown.base),
            BreakdownRow(label: "Age adjustment", amount: breakdown.age),
            BreakdownRow(label: "Sex adjustment", amount: breakdown.sex),
            BreakdownRow(label: "Exercise (\(state.profile.activityMinutes) min)", amount: breakdown.activity),
            BreakdownRow(label: "Climate", amount: breakdown.climate),
            BreakdownRow(label: "Life stage", amount: breakdown.lifeStage),
            BreakdownRow(label: "Fluid from food", amount: breakdown.food),
            BreakdownRow(label: "Estimated need", amount: breakdown.total, emphasised: true)
        ]
        return Card(title: "Daily target") {
            ForEach(rows) { row in
                HStack {
                    Text(row.label).font(row.emphasised ? .subheadline.weight(.bold) : .footnote)
                        .foregroundStyle(row.emphasised ? palette.text : palette.dim)
                    Spacer()
                    Text(signed(row.amount, showSign: !row.emphasised))
                        .font(.subheadline.weight(.bold))
                        .foregroundStyle(row.emphasised ? palette.accent : palette.text)
                }
                .padding(.vertical, 4)
                Divider().overlay(palette.line)
            }
            HStack {
                Text(state.goalOverrideMilliliters != nil ? "Your adjusted target" : "Your daily target")
                    .font(.subheadline.weight(.bold))
                Spacer()
                Text(store.format(store.goal)).font(.headline).foregroundStyle(palette.accent)
            }
            .padding(.vertical, 4)

            HStack(spacing: 10) {
                Button("− \(store.format(HydrationEngine.stepMilliliters(units: state.units)))") {
                    store.nudgeGoal(by: -HydrationEngine.stepMilliliters(units: state.units))
                }
                Button("Use estimate") { store.useEstimatedGoal() }
                Button("+ \(store.format(HydrationEngine.stepMilliliters(units: state.units)))") {
                    store.nudgeGoal(by: HydrationEngine.stepMilliliters(units: state.units))
                }
            }
            .font(.footnote)
            .buttonStyle(PillButtonStyle())
        }
    }

    private var containersCard: some View {
        Card(title: "Your containers",
             subtitle: "Set the four quick buttons to the glasses and bottles you actually own.") {
            HStack(spacing: 10) {
                ForEach(presetDrafts.indices, id: \.self) { index in
                    TextField("0", text: Binding(
                        get: { presetDrafts.indices.contains(index) ? presetDrafts[index] : "" },
                        set: { value in
                            if presetDrafts.indices.contains(index) { presetDrafts[index] = value }
                        }))
                    .keyboardType(.numberPad)
                    .multilineTextAlignment(.center)
                    .padding(.vertical, 12)
                    .background(palette.card, in: RoundedRectangle(cornerRadius: 13))
                    .overlay(RoundedRectangle(cornerRadius: 13).strokeBorder(palette.line))
                }
            }
            Button("Save quick amounts") {
                let values = presetDrafts.compactMap { Int($0) }.filter { $0 > 0 }
                guard values.count == 4 else { Haptics.warning(); return }
                store.edit { $0.presets = values }
                Haptics.success()
            }
            .buttonStyle(PillButtonStyle())
        }
    }

    private var remindersCard: some View {
        Card(title: "Reminders") {
            Toggle(isOn: Binding(
                get: { state.reminders.enabled },
                set: { on in Task { await store.setRemindersEnabled(on) } })) {
                    VStack(alignment: .leading, spacing: 3) {
                        Text("Nudge me during the day").font(.subheadline.weight(.bold))
                        Text("Real notifications, so they arrive with the app closed. Nothing is scheduled between bed and wake.")
                            .font(.caption2).foregroundStyle(palette.dimmer)
                    }
                }
                .tint(palette.accent)

            VStack(alignment: .leading, spacing: 6) {
                Text("Every \(state.reminders.intervalMinutes) minutes")
                    .font(.caption.weight(.bold)).foregroundStyle(palette.dim)
                Slider(value: Binding(
                    get: { Double(state.reminders.intervalMinutes) },
                    set: { value in store.edit { $0.reminders.intervalMinutes = Int(value) } }),
                       in: 30...240, step: 15) { _ in
                    store.rescheduleReminders()
                }
                .tint(palette.accent)
                Text(scheduleSummary).font(.caption2).foregroundStyle(palette.dimmer)
            }

            Button("Send a test nudge") {
                Task { await store.notifications.sendTestNudge(state: state) }
                Haptics.tap()
            }
            .buttonStyle(PillButtonStyle())
        }
    }

    private var scheduleSummary: String {
        let slots = NotificationManager.slots(profile: state.profile,
                                              intervalMinutes: state.reminders.intervalMinutes, limit: 32)
        guard let first = slots.first, let last = slots.last else {
            return "No room for reminders between your wake and bed times."
        }
        return "\(slots.count) reminders a day, \(clock(first)) to \(clock(last))."
    }

    private var healthCard: some View {
        Card(title: "Apple Health") {
            Toggle(isOn: Binding(
                get: { state.health.syncEnabled },
                set: { on in Task { await store.setHealthSync(on) } })) {
                    VStack(alignment: .leading, spacing: 3) {
                        Text("Write drinks to Health").font(.subheadline.weight(.bold))
                        Text("Each logged drink is saved as dietary water. Deleting a drink here deletes the sample it wrote.")
                            .font(.caption2).foregroundStyle(palette.dimmer)
                    }
                }
                .tint(palette.accent)
                .disabled(!store.health.isAvailable)

            Text(store.health.status).font(.caption2).foregroundStyle(palette.dimmer)
        }
    }

    private var dataCard: some View {
        Card(title: "Data", subtitle: "Everything lives on this device. Nothing is uploaded, ever.") {
            HStack(spacing: 10) {
                if let exportURL {
                    ShareLink(item: exportURL) { Text("⬇️ Export JSON").frame(maxWidth: .infinity) }
                        .buttonStyle(PillButtonStyle())
                } else {
                    Button("⬇️ Prepare export") { prepareExport() }
                        .buttonStyle(PillButtonStyle())
                }
                Button("Burn it all down") { showResetConfirm = true }
                    .buttonStyle(PillButtonStyle())
                    .foregroundStyle(.red)
            }
        }
    }

    private var disclaimerCard: some View {
        Card(title: "The boring but important part") {
            Text("This target is an estimate from body size, activity, climate and life stage — not medical advice. Roughly a fifth of your daily fluid comes from food and is already subtracted. If you have kidney, heart or liver conditions, or take medication affecting fluid balance, use your clinician's number instead. Rebellion is for authority, not nephrology.")
                .font(.caption)
                .foregroundStyle(palette.dimmer)
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    // MARK: - Helpers

    private func syncDrafts() {
        presetDrafts = state.presets.map(String.init)
    }

    private func signed(_ value: Double, showSign: Bool) -> String {
        let text = store.format(abs(value))
        guard showSign else { return text }
        return (value < 0 ? "−" : "+") + text
    }

    private func clock(_ minutes: Int) -> String {
        String(format: "%02d:%02d", minutes / 60, minutes % 60)
    }

    /// Bridges minutes-after-midnight storage to SwiftUI's DatePicker.
    private func timeBinding(for keyPath: WritableKeyPath<Profile, Int>) -> Binding<Date> {
        Binding(
            get: {
                let minutes = store.state.profile[keyPath: keyPath]
                return Calendar.current.date(bySettingHour: minutes / 60, minute: minutes % 60,
                                             second: 0, of: .now) ?? .now
            },
            set: { date in
                let minutes = HydrationEngine.minutes(from: date)
                store.edit { $0.profile[keyPath: keyPath] = minutes }
                store.rescheduleReminders()
            })
    }

    private func prepareExport() {
        guard let data = store.exportJSON() else { return }
        let url = URL.temporaryDirectory
            .appendingPathComponent("hydrobuddy-\(HydrationEngine.dayKey()).json")
        try? data.write(to: url, options: .atomic)
        exportURL = url
        Haptics.tap()
    }
}
