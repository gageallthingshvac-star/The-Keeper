import SwiftUI

struct TodayView: View {
    @EnvironmentObject private var store: Store
    @Environment(\.palette) private var palette
    @State private var showingCustom = false

    private var state: AppState { store.state }
    private var goal: Double { store.goal }
    private var remaining: Double { max(0, goal - store.todayTotal) }

    var body: some View {
        Page {
            coachCard
            ringCard
            logCard
            historyCard
        }
        .sheet(isPresented: $showingCustom) {
            CustomDrinkSheet().environmentObject(store).environment(\.palette, palette)
        }
    }

    // MARK: - Coach

    private var coachCard: some View {
        Card {
            let message = store.lastMessage
            HStack(alignment: .top, spacing: 12) {
                Text(state.coach.emoji)
                    .font(.system(size: 32))
                    .frame(width: 60, height: 60)
                    .background(palette.accent.opacity(0.16), in: Circle())
                    .overlay(Circle().strokeBorder(palette.line))
                    .id(state.coachID)
                    .transition(.scale)

                VStack(alignment: .leading, spacing: 4) {
                    Text(state.coach.title.uppercased())
                        .font(.caption2.weight(.heavy))
                        .kerning(1)
                        .foregroundStyle(palette.accent)
                    Text(message?.text ?? "Let's get you set up.")
                        .font(.callout)
                        .fixedSize(horizontal: false, vertical: true)
                    if let chaos = message?.chaos {
                        Text(chaos)
                            .font(.callout.weight(state.vibe == .feral ? .bold : .regular))
                            .italic(state.vibe != .feral)
                            .foregroundStyle(state.vibe == .feral ? palette.good : palette.dim)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    if let name = message?.techniqueName, let why = message?.techniqueWhy {
                        VStack(alignment: .leading, spacing: 4) {
                            Text("🧠 \(name.uppercased())")
                                .font(.caption2.weight(.heavy))
                                .padding(.horizontal, 9).padding(.vertical, 4)
                                .background(palette.accent.opacity(0.16), in: Capsule())
                                .overlay(Capsule().strokeBorder(palette.line))
                                .foregroundStyle(palette.accent)
                            Text("why: \(why)")
                                .font(.caption2)
                                .foregroundStyle(palette.dimmer)
                                .fixedSize(horizontal: false, vertical: true)
                        }
                        .padding(.top, 2)
                    }
                }
            }

            HStack(spacing: 10) {
                Button("💬 Say something else") {
                    store.refreshMessage()
                    Haptics.tap()
                }
                Button("🎲 Different animal") {
                    let others = Coach.all.filter { $0.id != state.coachID }
                    if let next = others.randomElement() { store.setCoach(next.id) }
                    Haptics.tap()
                }
            }
            .font(.footnote)
            .buttonStyle(PillButtonStyle())
        }
    }

    // MARK: - Ring

    private var ringCard: some View {
        Card {
            VStack(spacing: 12) {
                RingView(progress: store.progress,
                         centerValue: "\(HydrationEngine.displayNumber(store.todayTotal, units: state.units))",
                         goalText: "of \(store.format(goal))",
                         percentText: "\(Int((store.progress * 100).rounded()))%")

                Text(remainderText)
                    .font(.footnote)
                    .multilineTextAlignment(.center)
                    .foregroundStyle(palette.dim)

                if state.onboarded, remaining > 0 {
                    paceChip
                }
            }
            .frame(maxWidth: .infinity)
        }
    }

    private var remainderText: String {
        guard state.onboarded else { return "Open Setup and get a target built around your actual body." }
        if remaining > 0 {
            let minutesLeft = state.profile.sleepMinutes - HydrationEngine.minutes(from: .now)
            let hours = max(0, Int((Double(minutesLeft) / 60).rounded()))
            return hours > 0
                ? "\(store.format(remaining)) to go · roughly \(hours)h before bed"
                : "\(store.format(remaining)) to go · it's late, go gently"
        }
        if store.progress >= 1.6 { return "Well past target. Ease off — this isn't a contest." }
        return "Target met, \(store.format(store.todayTotal - goal)) over. Excellent behaviour."
    }

    private var paceChip: some View {
        let pace = store.pace
        let behind = pace.delta < -0.03 * goal
        let text: String
        if pace.through <= 0.02 {
            text = "🌅 Day's just started"
        } else if behind {
            text = "⏳ \(store.format(-pace.delta)) behind pace"
        } else {
            text = "✅ On pace for this time of day"
        }
        let tint = pace.through <= 0.02 ? palette.dim : (behind ? Color(hex: "fbbf24") : palette.good)
        return Text(text)
            .font(.caption.weight(.heavy))
            .foregroundStyle(tint)
            .padding(.horizontal, 12).padding(.vertical, 6)
            .background(tint.opacity(0.12), in: Capsule())
            .overlay(Capsule().strokeBorder(tint.opacity(0.3)))
    }

    // MARK: - Logging

    private var logCard: some View {
        Card(title: "Log a drink",
             subtitle: "\(state.selectedDrink.name) counts at \(Int(state.selectedDrink.factor * 100))% toward your target. Tap an amount.") {
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    ForEach(DrinkType.all) { drink in
                        Button {
                            store.edit { $0.selectedDrinkID = drink.id }
                            Haptics.tap()
                        } label: {
                            HStack(spacing: 6) {
                                Text(drink.emoji)
                                Text(drink.name).font(.subheadline.weight(.bold))
                                Text("\(Int(drink.factor * 100))%")
                                    .font(.caption2.weight(.bold))
                                    .foregroundStyle(palette.dimmer)
                            }
                            .padding(.horizontal, 14).padding(.vertical, 10)
                            .background(drink.id == state.selectedDrinkID ? palette.accent.opacity(0.18) : palette.card,
                                        in: Capsule())
                            .overlay(Capsule().strokeBorder(drink.id == state.selectedDrinkID ? palette.accent : palette.line))
                        }
                        .buttonStyle(.plain)
                    }
                }
                .padding(.vertical, 2)
            }

            LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 10), count: 4), spacing: 10) {
                ForEach(state.presets, id: \.self) { amount in
                    Button {
                        store.log(state.selectedDrink,
                                  millilitres: HydrationEngine.toMillilitres(Double(amount), units: state.units))
                        Haptics.success()
                    } label: {
                        VStack(spacing: 1) {
                            Text("\(amount)").font(.title3.weight(.heavy))
                            Text("\(state.units.short) \(state.selectedDrink.emoji)")
                                .font(.caption2.weight(.bold))
                                .foregroundStyle(palette.dim)
                        }
                    }
                    .buttonStyle(PillButtonStyle())
                    .accessibilityLabel("Log \(amount) \(state.units.short) of \(state.selectedDrink.name)")
                }
            }

            HStack(spacing: 10) {
                Button("✏️ Custom") { showingCustom = true }
                Button("↩️ Undo last") {
                    store.undoLast()
                    Haptics.warning()
                }
                .disabled(store.todayEntries.isEmpty)
            }
            .buttonStyle(PillButtonStyle())

            if state.selectedDrink.isAlcohol || store.hadAlcoholToday {
                VStack(alignment: .leading, spacing: 10) {
                    Text("Alcohol is a diuretic. It's logged at a reduced hydration value and your coach is going to bring it up.")
                        .font(.caption)
                        .foregroundStyle(Color(hex: "ffdcae"))
                    Button("💧 Chase it with a glass of water") {
                        store.log(DrinkType.named("water"),
                                  millilitres: state.units == .oz ? 12 * HydrationEngine.millilitresPerOunce : 350)
                        Haptics.success()
                    }
                    .buttonStyle(PillButtonStyle())
                }
                .padding(12)
                .background(Color(hex: "fbbf24").opacity(0.08), in: RoundedRectangle(cornerRadius: 14))
                .overlay(RoundedRectangle(cornerRadius: 14).strokeBorder(Color(hex: "fbbf24").opacity(0.26)))
            }
        }
    }

    private var historyCard: some View {
        Card(title: "Today's log") {
            if store.todayEntries.isEmpty {
                Text(state.vibe == .feral ? "🫙  Empty. Bone dry. Do something about it." : "🫙  Nothing logged yet today.")
                    .font(.footnote)
                    .foregroundStyle(palette.dimmer)
                    .frame(maxWidth: .infinity, alignment: .center)
                    .padding(.vertical, 14)
            } else {
                ForEach(store.todayEntries) { entry in
                    HStack(spacing: 12) {
                        Text(entry.type.emoji).font(.title3).frame(width: 30)
                        VStack(alignment: .leading, spacing: 1) {
                            Text("\(store.format(entry.milliliters)) \(entry.type.name.lowercased())")
                                .font(.subheadline.weight(.bold))
                            Text(detail(for: entry))
                                .font(.caption2)
                                .foregroundStyle(palette.dimmer)
                        }
                        Spacer()
                        Button {
                            store.remove(entry)
                            Haptics.warning()
                        } label: {
                            Image(systemName: "xmark")
                                .font(.caption.weight(.bold))
                                .frame(width: 40, height: 40)
                                .foregroundStyle(palette.dimmer)
                                .overlay(RoundedRectangle(cornerRadius: 11).strokeBorder(palette.line))
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel("Remove \(entry.type.name)")
                    }
                    .padding(.vertical, 6)
                    if entry.id != store.todayEntries.last?.id {
                        Divider().overlay(palette.line)
                    }
                }
            }
        }
    }

    private func detail(for entry: DrinkEntry) -> String {
        var text = entry.date.formatted(date: .omitted, time: .shortened)
        if entry.effectiveMilliliters != entry.milliliters {
            text += " · counts as \(store.format(entry.effectiveMilliliters))"
        }
        if entry.healthSampleID != nil { text += " · in Health" }
        return text
    }
}

struct CustomDrinkSheet: View {
    @EnvironmentObject private var store: Store
    @Environment(\.palette) private var palette
    @Environment(\.dismiss) private var dismiss
    @State private var amount = ""
    @State private var typeID = "water"
    @State private var error: String?

    var body: some View {
        NavigationStack {
            Form {
                Section("Amount") {
                    TextField("Amount in \(store.state.units.short)", text: $amount)
                        .keyboardType(.decimalPad)
                }
                Section("Drink") {
                    Picker("Drink", selection: $typeID) {
                        ForEach(DrinkType.all) { drink in
                            Text("\(drink.emoji) \(drink.name) (\(Int(drink.factor * 100))%)").tag(drink.id)
                        }
                    }
                    .pickerStyle(.wheel)
                }
                if let error {
                    Text(error).font(.footnote).foregroundStyle(.red)
                }
            }
            .navigationTitle("Custom amount")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) { Button("Add", action: submit) }
            }
        }
        .onAppear {
            typeID = store.state.selectedDrinkID
            amount = store.state.units == .oz ? "10" : "300"
        }
    }

    /// Validation says what is wrong instead of silently doing nothing.
    private func submit() {
        guard let value = Double(amount.replacingOccurrences(of: ",", with: ".")) else {
            error = "That isn't a number."
            return
        }
        guard value > 0 else { error = "Amount has to be more than zero."; return }
        let ml = HydrationEngine.toMillilitres(value, units: store.state.units)
        guard ml <= 3000 else {
            error = "That's over \(store.format(3000)) in one go — split it into a few entries."
            return
        }
        store.log(DrinkType.named(typeID), millilitres: ml)
        Haptics.success()
        dismiss()
    }
}
