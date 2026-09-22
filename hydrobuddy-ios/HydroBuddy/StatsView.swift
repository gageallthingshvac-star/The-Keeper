import SwiftUI
import Charts

struct StatsView: View {
    @EnvironmentObject private var store: Store
    @Environment(\.palette) private var palette
    @State private var selectedDay: String?

    private var state: AppState { store.state }
    private var goal: Double { store.goal }

    private struct MixRow: Identifiable {
        let typeID: String
        let millilitres: Double
        var id: String { typeID }
    }

    private struct DayBar: Identifiable {
        let id: String
        let date: Date
        let total: Double
        let met: Bool
    }

    private var week: [DayBar] {
        HydrationEngine.lastDayKeys(7, endingAt: store.todayKey).map { key in
            DayBar(id: key,
                   date: HydrationEngine.date(fromDayKey: key) ?? .now,
                   total: HydrationEngine.total(state.log, on: key),
                   met: HydrationEngine.metGoal(state.log, on: key, goal: goal))
        }
    }

    var body: some View {
        Page {
            chartCard
            receiptsCard
            mixCard
        }
    }

    private var chartCard: some View {
        Card(title: "Last 7 days", subtitle: "Dashed line is your target of \(store.format(goal)). Tap a bar for that day.") {
            Chart {
                ForEach(week) { day in
                    BarMark(
                        x: .value("Day", day.date, unit: .day),
                        y: .value("Total", HydrationEngine.toDisplay(day.total, units: state.units))
                    )
                    .foregroundStyle(day.met ? palette.good : palette.accent)
                    .opacity(selectedDay == nil || selectedDay == day.id ? 1 : 0.45)
                    .cornerRadius(7)
                }
                RuleMark(y: .value("Target", HydrationEngine.toDisplay(goal, units: state.units)))
                    .lineStyle(StrokeStyle(lineWidth: 1, dash: [4, 4]))
                    .foregroundStyle(palette.dim.opacity(0.7))
            }
            .chartXAxis {
                AxisMarks(values: .stride(by: .day)) { _ in
                    AxisValueLabel(format: .dateTime.weekday(.narrow))
                }
            }
            .chartYAxis {
                AxisMarks { _ in
                    AxisGridLine().foregroundStyle(palette.line)
                    AxisValueLabel()
                }
            }
            .frame(height: 170)
            .chartOverlay { proxy in
                GeometryReader { geo in
                    Rectangle().fill(.clear).contentShape(Rectangle())
                        .gesture(SpatialTapGesture().onEnded { tap in
                            guard let plotFrame = proxy.plotFrame else { return }
                            let x = tap.location.x - geo[plotFrame].origin.x
                            guard let date: Date = proxy.value(atX: x) else { return }
                            let key = HydrationEngine.dayKey(date)
                            selectedDay = selectedDay == key ? nil : key
                            Haptics.tap()
                        })
                }
            }

            Text(detailText)
                .font(.footnote)
                .foregroundStyle(palette.dim)
                .frame(maxWidth: .infinity, alignment: .center)
                .frame(minHeight: 20)
        }
    }

    private var detailText: String {
        guard let key = selectedDay, let date = HydrationEngine.date(fromDayKey: key) else { return "" }
        let entries = HydrationEngine.entries(state.log, on: key)
        let label = date.formatted(.dateTime.weekday(.wide).month(.abbreviated).day())
        guard !entries.isEmpty else { return "\(label) — nothing logged." }
        let total = HydrationEngine.total(state.log, on: key)
        let suffix = HydrationEngine.metGoal(state.log, on: key, goal: goal)
            ? "target met"
            : "\(store.format(max(0, goal - total))) short"
        return "\(label) — \(store.format(total)) across \(entries.count) drink\(entries.count == 1 ? "" : "s") · \(suffix)"
    }

    private struct Receipt: Identifiable {
        let label: String
        let value: String
        var id: String { label }
    }

    private var receiptsCard: some View {
        let stats = HydrationEngine.trackedStats(state.log, days: 30, goal: goal, today: store.todayKey)
        let best = HydrationEngine.bestStreak(state.log, goal: goal, today: store.todayKey)
        let cells = [
            Receipt(label: "today", value: "\(Int((store.progress * 100).rounded()))%"),
            Receipt(label: "current streak", value: "\(store.streak)d"),
            Receipt(label: "best streak", value: "\(best)d"),
            Receipt(label: "30-day average", value: stats.loggedDays > 0 ? store.format(stats.average) : "—"),
            Receipt(label: "targets met (30d)", value: "\(stats.metDays)/\(stats.loggedDays)"),
            Receipt(label: "volume today", value: store.format(HydrationEngine.rawVolume(state.log, on: store.todayKey)))
        ]
        return Card(title: "Receipts") {
            LazyVGrid(columns: [GridItem(.flexible(), spacing: 10), GridItem(.flexible(), spacing: 10)], spacing: 10) {
                ForEach(cells) { cell in
                    VStack(alignment: .leading, spacing: 3) {
                        Text(cell.value).font(.title3.weight(.heavy))
                        Text(cell.label.uppercased())
                            .font(.caption2.weight(.heavy))
                            .kerning(0.6)
                            .foregroundStyle(palette.dimmer)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(13)
                    .background(palette.card, in: RoundedRectangle(cornerRadius: 15))
                    .overlay(RoundedRectangle(cornerRadius: 15).strokeBorder(palette.line))
                }
            }
        }
    }

    private var mixCard: some View {
        var totals: [String: Double] = [:]
        var grand = 0.0
        for key in HydrationEngine.lastDayKeys(30, endingAt: store.todayKey) {
            for entry in HydrationEngine.entries(state.log, on: key) {
                totals[entry.typeID, default: 0] += entry.milliliters
                grand += entry.milliliters
            }
        }
        let rows = totals.sorted { $0.value > $1.value }.map { MixRow(typeID: $0.key, millilitres: $0.value) }

        return Card(title: "What you actually drink") {
            if grand == 0 {
                Text("📊  Log a few drinks and your habits show up here, honestly and without mercy.")
                    .font(.footnote)
                    .foregroundStyle(palette.dimmer)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 12)
            } else {
                ForEach(rows) { row in
                    let drink = DrinkType.named(row.typeID)
                    HStack(spacing: 12) {
                        Text(drink.emoji).font(.title3).frame(width: 30)
                        VStack(alignment: .leading, spacing: 1) {
                            Text("\(drink.name) — \(Int((row.millilitres / grand * 100).rounded()))%")
                                .font(.subheadline.weight(.bold))
                            Text("\(store.format(row.millilitres)) over 30 days")
                                .font(.caption2).foregroundStyle(palette.dimmer)
                        }
                        Spacer()
                    }
                    .padding(.vertical, 5)
                }
            }
        }
    }
}
