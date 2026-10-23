import SwiftUI

struct CoachView: View {
    @EnvironmentObject private var store: Store
    @Environment(\.palette) private var palette

    private var state: AppState { store.state }

    var body: some View {
        Page {
            vibeCard
            rosterCard
            psychToggleCard
            if state.psych.enabled { techniquesCard }
            explainerCard
        }
    }

    private var vibeCard: some View {
        Card(title: "Vibe", subtitle: "How much chaos do you want in your reminders?") {
            Picker("Vibe", selection: Binding(
                get: { state.vibe },
                set: { vibe in
                    store.setVibe(vibe)
                    Haptics.success()
                })) {
                    ForEach(Vibe.allCases, id: \.self) { Text($0.label).tag($0) }
                }
                .pickerStyle(.segmented)

            Text(state.vibe == .feral
                 ? "Feral mode. Your coach gets meaner, the app goes hot pink, and every message picks up a line of anti-authority nonsense. Same honest numbers underneath — only the delivery is unhinged."
                 : "Standard mode. Your coach stays in character but keeps it civil. Switch to Feral if polite reminders bounce straight off you.")
            .font(.caption)
            .foregroundStyle(palette.dimmer)
        }
    }

    private var rosterCard: some View {
        Card(title: "Your coach",
             subtitle: "Ten animals, ten ways of getting on your nerves. Pick the one you'd actually obey.") {
            LazyVGrid(columns: [GridItem(.flexible(), spacing: 10), GridItem(.flexible(), spacing: 10)], spacing: 10) {
                ForEach(Coach.all) { coach in
                    Button {
                        store.setCoach(coach.id)
                        Haptics.tap()
                    } label: {
                        VStack(alignment: .leading, spacing: 7) {
                            Text(coach.emoji).font(.title2)
                            Text(coach.name).font(.subheadline.weight(.heavy))
                            Text("\(coach.species) · \(coach.vibe)")
                                .font(.caption2.weight(.heavy))
                                .textCase(.uppercase)
                                .foregroundStyle(Color(hex: coach.accentHex))
                            Text(coach.blurb)
                                .font(.caption2)
                                .foregroundStyle(palette.dimmer)
                                .fixedSize(horizontal: false, vertical: true)
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(12)
                        .background(coach.id == state.coachID
                                    ? Color(hex: coach.accentHex).opacity(0.14) : palette.card,
                                    in: RoundedRectangle(cornerRadius: 16))
                        .overlay(RoundedRectangle(cornerRadius: 16)
                            .strokeBorder(coach.id == state.coachID ? Color(hex: coach.accentHex) : palette.line))
                    }
                    .buttonStyle(.plain)
                }
            }
        }
    }

    private var psychToggleCard: some View {
        Card {
            Toggle(isOn: Binding(
                get: { state.psych.enabled },
                set: { on in
                    store.edit { $0.psych.enabled = on }
                    store.refreshMessage()
                })) {
                    VStack(alignment: .leading, spacing: 3) {
                        Text("Psychology-based motivation").font(.subheadline.weight(.bold))
                        Text("Off by default. On, your coach uses real behaviour-change techniques and names the one it's pulling on you every time.")
                            .font(.caption2)
                            .foregroundStyle(palette.dimmer)
                    }
                }
                .tint(palette.accent)
        }
    }

    private var techniquesCard: some View {
        Card(title: "Techniques",
             subtitle: "Keep what works. Anything that feels like a boot on your neck, switch it off.") {
            ForEach(CoachEngine.techniques) { technique in
                Toggle(isOn: Binding(
                    get: { state.psych.isOn(technique.id) },
                    set: { on in
                        store.edit { $0.psych.techniques[technique.id] = on }
                        store.refreshMessage()
                    })) {
                        VStack(alignment: .leading, spacing: 3) {
                            Text(technique.name).font(.subheadline.weight(.bold))
                            Text(technique.why).font(.caption2).foregroundStyle(palette.dimmer)
                                .fixedSize(horizontal: false, vertical: true)
                        }
                    }
                    .tint(palette.accent)
                if technique.id != CoachEngine.techniques.last?.id {
                    Divider().overlay(palette.line)
                }
            }

            VStack(alignment: .leading, spacing: 6) {
                Text("YOUR IF–THEN PLAN").font(.caption2.weight(.heavy)).kerning(0.8).foregroundStyle(palette.dim)
                TextField("After I pour my morning coffee, I drink one full glass of water.",
                          text: Binding(get: { state.psych.plan },
                                        set: { value in store.edit { $0.psych.plan = value } }),
                          axis: .vertical)
                .lineLimit(2...4)
                .textFieldStyle(.roundedBorder)
                Text("Concrete cue → concrete action. Vague plans die.")
                    .font(.caption2).foregroundStyle(palette.dimmer)
            }
            .padding(.top, 6)

            VStack(alignment: .leading, spacing: 6) {
                Text("TEMPTATION BUNDLE").font(.caption2.weight(.heavy)).kerning(0.8).foregroundStyle(palette.dim)
                TextField("only doomscroll while finishing a glass",
                          text: Binding(get: { state.psych.bundle },
                                        set: { value in store.edit { $0.psych.bundle = value } }))
                .textFieldStyle(.roundedBorder)
                Text("Chains the habit you want to a thing you already can't stop doing.")
                    .font(.caption2).foregroundStyle(palette.dimmer)
            }

            Button("Save and re-roll the message") {
                store.saveNow()
                store.refreshMessage()
                Haptics.success()
            }
            .buttonStyle(PillButtonStyle(prominent: true))
        }
    }

    private var explainerCard: some View {
        Card(title: "What's actually happening here") {
            Text(state.psych.enabled
                 ? "Your coach adds one behaviour-change technique per message and names it, so you always know what's being run on you. No invented statistics: every claim about your habits is computed from your own log. Kill the whole thing with the toggle above and it reverts to plain encouragement."
                 : "Right now it's plain encouragement — your coach reacts to your progress and nothing else. Switch it on for opt-in techniques: streaks, loss framing, if–then plans, self-compassion and the rest. Each message labels the one it used, and every technique has its own off switch.")
            .font(.caption)
            .foregroundStyle(palette.dimmer)
            .fixedSize(horizontal: false, vertical: true)
        }
    }
}
