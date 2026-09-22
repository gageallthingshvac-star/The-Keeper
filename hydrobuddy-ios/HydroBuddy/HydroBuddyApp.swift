import SwiftUI

@main
struct HydroBuddyApp: App {
    @StateObject private var store = Store()
    @Environment(\.scenePhase) private var scenePhase

    var body: some Scene {
        WindowGroup {
            RootView()
                .environmentObject(store)
                .preferredColorScheme(.dark)
                .task {
                    store.refreshMessage()
                    await store.notifications.refreshAuthorization()
                    store.health.refreshStatus()
                }
        }
        .onChange(of: scenePhase) { _, phase in
            switch phase {
            case .active:
                store.refreshForNewDayIfNeeded()
                store.health.refreshStatus()
            case .background, .inactive:
                store.saveNow()
            @unknown default:
                break
            }
        }
    }
}

struct RootView: View {
    @EnvironmentObject private var store: Store
    @State private var tab = Tab.today

    enum Tab: Hashable { case today, coach, stats, setup }

    private var palette: Palette { Palette.make(coach: store.state.coach, vibe: store.state.vibe) }

    var body: some View {
        TabView(selection: $tab) {
            TodayView().tabItem { Label("Today", systemImage: "drop.fill") }.tag(Tab.today)
            CoachView().tabItem { Label("Coach", systemImage: "pawprint.fill") }.tag(Tab.coach)
            StatsView().tabItem { Label("Stats", systemImage: "chart.bar.fill") }.tag(Tab.stats)
            SetupView().tabItem { Label("Setup", systemImage: "gearshape.fill") }.tag(Tab.setup)
        }
        .tint(palette.accent)
        .environment(\.palette, palette)
        .background(AppBackground(palette: palette))
        .onAppear {
            if !store.state.onboarded { tab = .setup }
        }
        .animation(.easeInOut(duration: 0.35), value: store.state.vibe)
        .animation(.easeInOut(duration: 0.35), value: store.state.coachID)
    }
}

/// Shared page scaffold: gradient background, scrolling content, matching header.
struct Page<Content: View>: View {
    @EnvironmentObject private var store: Store
    @Environment(\.palette) private var palette
    @ViewBuilder var content: Content

    var body: some View {
        ZStack {
            AppBackground(palette: palette)
            ScrollView {
                VStack(spacing: 14) {
                    header
                    content
                }
                .padding(.horizontal, 16)
                .padding(.bottom, 24)
            }
            .scrollDismissesKeyboard(.interactively)
        }
        .foregroundStyle(palette.text)
    }

    private var header: some View {
        HStack(alignment: .firstTextBaseline) {
            VStack(alignment: .leading, spacing: 1) {
                HStack(spacing: 3) {
                    Text("💧").font(.callout)
                    Text("HydroBuddy").font(.title3.weight(.heavy))
                    Text("+").font(.title2.weight(.heavy)).foregroundStyle(palette.accent)
                }
                Text(Date.now.formatted(.dateTime.weekday(.wide).month(.abbreviated).day()))
                    .font(.caption2.weight(.bold))
                    .kerning(0.5)
                    .textCase(.uppercase)
                    .foregroundStyle(palette.dimmer)
            }
            Spacer()
            HStack(spacing: 5) {
                Text("🔥")
                Text("\(store.streak)").font(.callout.weight(.heavy))
                Text("day streak").font(.caption).foregroundStyle(palette.dim)
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 8)
            .background(palette.card, in: Capsule())
            .overlay(Capsule().strokeBorder(palette.line))
        }
        .padding(.top, 8)
    }
}
