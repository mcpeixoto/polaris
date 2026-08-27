import SwiftUI

/// The press response, on every interactive control in the app.
///
/// 0.98 is deliberately small: enough that a tap feels answered, not so much that a list of
/// them looks like it is breathing. Applied to buttons, cards-as-buttons, chips and rows —
/// the only opt-out is `.plain` for inline text links.
struct PressableStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .scaleEffect(configuration.isPressed ? 0.98 : 1)
            .animation(.easeOut(duration: 0.12), value: configuration.isPressed)
    }
}

/// Fade-and-rise entrance, staggered by position.
///
/// The index cap matters: without it a 200-row list animates for ten seconds and the last
/// rows arrive long after the reader has started scrolling. Twelve rows is roughly one
/// screenful, which is all anyone sees on the first frame anyway.
struct StaggerRise: ViewModifier {
    let index: Int
    @State private var shown = false

    func body(content: Content) -> some View {
        content
            .opacity(shown ? 1 : 0)
            .offset(y: shown ? 0 : 14)
            .onAppear {
                withAnimation(Theme.easing(0.5).delay(Double(min(index, 12)) * 0.05)) {
                    shown = true
                }
            }
    }
}

extension View {
    func staggerRise(_ index: Int) -> some View {
        modifier(StaggerRise(index: index))
    }
}

/// The small uppercase label that sits above almost every headline in the app.
///
/// Tracking is proportional to the size (0.14em) rather than a fixed point value, so it stays
/// correct when Dynamic Type grows the text.
struct MonoEyebrow: View {
    let text: String
    var color: Color = Theme.eyebrowText
    var size: CGFloat = 11

    var body: some View {
        Text(text)
            .monoFont(size, weight: .medium)
            .tracking(size * 0.14)
            .textCase(.uppercase)
            .foregroundStyle(color)
            .accessibilityAddTraits(.isHeader)
    }
}

/// A 1pt separator. Not `Divider()`, which insets itself differently inside different
/// containers and cannot be coloured reliably.
struct HairlineDivider: View {
    var body: some View {
        Rectangle()
            .fill(Theme.hairline)
            .frame(height: 1)
    }
}

/// The surface everything sits on. Callers own their inner padding, because a card wrapping a
/// dense row and a card wrapping a form want different insets and baking one in makes the
/// other wrong.
struct Card<Content: View>: View {
    var radius: CGFloat = 20
    @ViewBuilder var content: () -> Content

    var body: some View {
        content()
            .background(Theme.card)
            .clipShape(RoundedRectangle(cornerRadius: radius, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: radius, style: .continuous)
                    .stroke(Theme.border, lineWidth: 1)
            )
    }
}

/// The primary call to action.
///
/// The coloured glow — a shadow whose y-offset exceeds its blur radius — is what separates a
/// designed CTA from `.borderedProminent`. `isBusy` swaps the label for a spinner in place
/// rather than disabling into ambiguity, so the button never changes size mid-tap.
struct PrimaryButton: View {
    let title: String
    var isBusy: Bool = false
    var isEnabled: Bool = true
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            ZStack {
                Text(title)
                    .bodyFont(15, weight: .bold)
                    .opacity(isBusy ? 0 : 1)
                if isBusy {
                    ProgressView().tint(.white)
                }
            }
            .foregroundStyle(.white)
            .frame(maxWidth: .infinity)
            .padding(.vertical, 16)
            .background(Theme.accent)
            .clipShape(RoundedRectangle(cornerRadius: 20, style: .continuous))
            .shadow(color: Theme.accent.opacity(0.45), radius: 15, x: 0, y: 16)
        }
        .buttonStyle(PressableStyle())
        .disabled(!isEnabled || isBusy)
        // Explicit, because the system's own disabled dimming is barely visible on a dark
        // background.
        .opacity(isEnabled && !isBusy ? 1 : 0.55)
    }
}

/// A field on a dark surface.
///
/// `prompt:` rather than the bare `TextField("Email", …)` label, because only the prompt form
/// lets the placeholder colour be set — the default is near-invisible here.
struct DarkFieldStyle: ViewModifier {
    func body(content: Content) -> some View {
        content
            .bodyFont(16, weight: .medium)
            .foregroundStyle(Theme.textPrimary)
            .tint(Theme.accentBright)
            .padding(.horizontal, 16)
            .padding(.vertical, 14)
            .background(Color.white.opacity(0.08))
            .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: 14, style: .continuous)
                    .stroke(Color.white.opacity(0.16), lineWidth: 1)
            )
    }
}

extension View {
    func darkField() -> some View { modifier(DarkFieldStyle()) }
}

/// The Polaris mark: a star that breathes, inside a ring that pulses outward.
///
/// Two off-phase loops rather than one — a single synchronised animation reads as a progress
/// indicator, which is exactly what this must not look like. Both are ambient and slow (2.4s
/// and 3.4s); a fast idle animation is the thing that makes an app feel cheap.
///
/// Honoured `accessibilityReduceMotion`: the marks holds still rather than animating, because
/// a permanently-moving element is precisely what that setting exists to stop.
struct PolarisMark: View {
    var size: CGFloat = 132
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var breathe = false
    @State private var ringOut = false

    var body: some View {
        ZStack {
            Circle()
                .stroke(Theme.accent, lineWidth: 2)
                .frame(width: size, height: size)
                .scaleEffect(ringOut ? 1.15 : 0.9)
                .opacity(ringOut ? 0 : 0.6)
                .animation(
                    reduceMotion ? nil : .easeOut(duration: 2.4).repeatForever(autoreverses: false),
                    value: ringOut
                )

            Circle()
                .fill(
                    RadialGradient(
                        colors: [Theme.accentBright, Theme.accentDark],
                        center: UnitPoint(x: 0.35, y: 0.28),
                        startRadius: 0,
                        endRadius: size * 0.6
                    )
                )
                .frame(width: size * 0.82, height: size * 0.82)
                .scaleEffect(breathe ? 1.04 : 0.97)
                .animation(
                    reduceMotion ? nil : .easeInOut(duration: 3.4).repeatForever(autoreverses: true),
                    value: breathe
                )
                .overlay(
                    Image(systemName: "sparkle")
                        .font(.system(size: size * 0.34, weight: .light))
                        .foregroundStyle(.white)
                )
                .shadow(color: Theme.accent.opacity(0.45), radius: 24, x: 0, y: 10)
        }
        .frame(width: size * 1.15, height: size * 1.15)
        .accessibilityHidden(true)
        .onAppear {
            // Under Reduce Motion these must stay false. The animations are nil there, so
            // setting them would snap each layer to its END state — and the ring's end state
            // is opacity 0, which deletes it. "Holds still" has to mean the start pose.
            guard !reduceMotion else { return }
            breathe = true
            ringOut = true
        }
    }
}
