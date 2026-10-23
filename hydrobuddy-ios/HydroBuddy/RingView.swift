import Foundation
import SwiftUI

/// Progress ring with a water level inside it. The wave only animates when the
/// system isn't asking for reduced motion.
struct RingView: View {
    @Environment(\.palette) private var palette
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var progress: Double
    var centerValue: String
    var goalText: String
    var percentText: String

    private var clamped: Double { min(max(progress, 0), 1) }

    var body: some View {
        ZStack {
            Circle()
                .stroke(Color.white.opacity(0.07), lineWidth: 13)

            Circle()
                .trim(from: 0, to: clamped)
                .stroke(
                    AngularGradient(colors: [palette.accent2, palette.accent, palette.accent2],
                                    center: .center),
                    style: StrokeStyle(lineWidth: 13, lineCap: .round)
                )
                .rotationEffect(.degrees(-90))
                .shadow(color: palette.accent.opacity(0.45), radius: 7)
                .animation(.spring(response: 0.7, dampingFraction: 0.85), value: clamped)

            water
                .padding(23)

            VStack(spacing: 3) {
                Text(centerValue)
                    .font(.system(size: 42, weight: .heavy, design: .rounded))
                    .monospacedDigit()
                    .contentTransition(.numericText())
                Text(goalText).font(.footnote.weight(.semibold)).foregroundStyle(palette.dim)
                Text(percentText).font(.caption.weight(.heavy)).foregroundStyle(palette.accent)
            }
        }
        .frame(width: 216, height: 216)
        .accessibilityElement(children: .combine)
        .accessibilityLabel("Hydration progress")
        .accessibilityValue("\(centerValue), \(goalText), \(percentText)")
    }

    private var water: some View {
        GeometryReader { geo in
            ZStack {
                Circle().fill(Color.black.opacity(0.55))
                if reduceMotion {
                    WaveShape(fill: clamped, phase: 0, amplitude: 0)
                        .fill(waveGradient)
                } else {
                    TimelineView(.animation) { timeline in
                        let t = timeline.date.timeIntervalSinceReferenceDate
                        ZStack {
                            WaveShape(fill: clamped, phase: t * 0.9, amplitude: 5)
                                .fill(waveGradient.opacity(0.55))
                            WaveShape(fill: clamped, phase: t * 1.35 + 2, amplitude: 3.5)
                                .fill(waveGradient)
                        }
                    }
                }
            }
            .frame(width: geo.size.width, height: geo.size.height)
            .clipShape(Circle())
            .overlay(Circle().strokeBorder(palette.line))
        }
    }

    private var waveGradient: LinearGradient {
        LinearGradient(colors: [palette.accent.opacity(0.75), palette.accent2.opacity(0.35)],
                       startPoint: .top, endPoint: .bottom)
    }
}

struct WaveShape: Shape {
    /// 0 = empty, 1 = full.
    var fill: Double
    var phase: Double
    var amplitude: Double

    var animatableData: Double {
        get { fill }
        set { fill = newValue }
    }

    func path(in rect: CGRect) -> Path {
        var path = Path()
        let level = rect.height * (1 - min(max(fill, 0), 1))
        let step: CGFloat = 4
        path.move(to: CGPoint(x: rect.minX, y: rect.maxY))
        path.addLine(to: CGPoint(x: rect.minX, y: level))
        var x = rect.minX
        while x <= rect.maxX {
            let relative = Double(x / max(rect.width, 1))
            let y = level + CGFloat(sin(relative * .pi * 2 + phase) * amplitude)
            path.addLine(to: CGPoint(x: x, y: y))
            x += step
        }
        path.addLine(to: CGPoint(x: rect.maxX, y: rect.maxY))
        path.closeSubpath()
        return path
    }
}
