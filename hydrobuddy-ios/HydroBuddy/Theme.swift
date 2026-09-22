import SwiftUI

extension Color {
    init(hex: String) {
        var s = hex.trimmingCharacters(in: CharacterSet(charactersIn: "#"))
        if s.count == 3 { s = s.map { "\($0)\($0)" }.joined() }
        let value = UInt64(s, radix: 16) ?? 0x38BDF8
        self.init(.sRGB,
                  red: Double((value >> 16) & 0xFF) / 255,
                  green: Double((value >> 8) & 0xFF) / 255,
                  blue: Double(value & 0xFF) / 255,
                  opacity: 1)
    }
}

/// Colours follow the chosen coach; Feral vibe overrides them wholesale.
struct Palette {
    var accent: Color
    var accent2: Color
    var background: Color
    var glowTop: Color
    var glowSide: Color
    var text: Color
    var dim: Color
    var dimmer: Color
    var card: Color
    var line: Color
    var good: Color

    static func make(coach: Coach, vibe: Vibe) -> Palette {
        if vibe == .feral {
            return Palette(
                accent: Color(hex: "ff2e97"),
                accent2: Color(hex: "c8ff3d"),
                background: Color(hex: "0b0410"),
                glowTop: Color(hex: "3d0b46"),
                glowSide: Color(hex: "1a0b2e"),
                text: Color(hex: "ffeaf9"),
                dim: Color(hex: "d59fd0"),
                dimmer: Color(hex: "9a6f9c"),
                card: Color.white.opacity(0.055),
                line: Color(hex: "ff6bd6").opacity(0.20),
                good: Color(hex: "c8ff3d")
            )
        }
        let accent = Color(hex: coach.accentHex)
        return Palette(
            accent: accent,
            accent2: accent.opacity(0.75),
            background: Color(hex: "050f18"),
            glowTop: Color(hex: "12384d"),
            glowSide: Color(hex: "0b2d3e"),
            text: Color(hex: "eaf7ff"),
            dim: Color(hex: "93b2c6"),
            dimmer: Color(hex: "5f7e92"),
            card: Color.white.opacity(0.05),
            line: Color.white.opacity(0.10),
            good: Color(hex: "34d399")
        )
    }
}

private struct PaletteKey: EnvironmentKey {
    static let defaultValue = Palette.make(coach: Coach.all[0], vibe: .standard)
}

extension EnvironmentValues {
    var palette: Palette {
        get { self[PaletteKey.self] }
        set { self[PaletteKey.self] = newValue }
    }
}

// MARK: - Reusable chrome

struct AppBackground: View {
    let palette: Palette

    var body: some View {
        ZStack {
            palette.background
            RadialGradient(colors: [palette.glowTop, .clear], center: .top, startRadius: 10, endRadius: 520)
                .opacity(0.85)
            RadialGradient(colors: [palette.glowSide, .clear], center: .topTrailing, startRadius: 10, endRadius: 460)
                .opacity(0.7)
        }
        .ignoresSafeArea()
    }
}

struct Card<Content: View>: View {
    @Environment(\.palette) private var palette
    var title: String?
    var subtitle: String?
    @ViewBuilder var content: Content

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            if let title {
                HStack(spacing: 8) {
                    Capsule()
                        .fill(LinearGradient(colors: [palette.accent, palette.accent2],
                                             startPoint: .top, endPoint: .bottom))
                        .frame(width: 3, height: 13)
                    Text(title.uppercased())
                        .font(.caption.weight(.heavy))
                        .kerning(1.1)
                        .foregroundStyle(palette.dim)
                }
            }
            if let subtitle {
                Text(subtitle)
                    .font(.footnote)
                    .foregroundStyle(palette.dimmer)
            }
            content
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(17)
        .background(palette.card, in: RoundedRectangle(cornerRadius: 20, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 20, style: .continuous).strokeBorder(palette.line))
    }
}

struct PillButtonStyle: ButtonStyle {
    @Environment(\.palette) private var palette
    var prominent = false

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.subheadline.weight(.bold))
            .frame(maxWidth: .infinity, minHeight: 48)
            .padding(.horizontal, 10)
            .background {
                if prominent {
                    LinearGradient(colors: [palette.accent, palette.accent2],
                                   startPoint: .topLeading, endPoint: .bottomTrailing)
                } else {
                    palette.card
                }
            }
            .foregroundStyle(prominent ? Color.black.opacity(0.82) : palette.text)
            .clipShape(RoundedRectangle(cornerRadius: 15, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 15, style: .continuous)
                .strokeBorder(prominent ? .clear : palette.line))
            .scaleEffect(configuration.isPressed ? 0.95 : 1)
            .animation(.spring(response: 0.25, dampingFraction: 0.6), value: configuration.isPressed)
    }
}
