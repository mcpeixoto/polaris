import SwiftUI

/// The press response, on every interactive control in the app.
///
/// 0.98 is deliberately small: enough that a tap feels answered, not so much that a list of
/// them looks like it is breathing. Applied to buttons, chips and rows — the only opt-out is
/// `.plain` for inline text links.
struct PressableStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .scaleEffect(configuration.isPressed ? 0.98 : 1)
            .animation(.easeOut(duration: 0.12), value: configuration.isPressed)
    }
}

/// The small heading over a group of things.
///
/// Plain, sentence-case, tertiary. It replaced a tracked uppercase monospace eyebrow: a label
/// that has to be decoded is a label that slows the scan, and the scan is what a list is for.
struct SectionLabel: View {
    let text: String
    var color: Color = Theme.eyebrowText

    var body: some View {
        Text(text)
            .font(PolarisText.sectionTitle)
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

/// A grouped surface: one step up from the page, hairline edge, small radius. Callers own
/// their inner padding, because a card wrapping a dense row and a card wrapping a form want
/// different insets and baking one in makes the other wrong.
struct Card<Content: View>: View {
    var radius: CGFloat = Theme.Radius.lg
    @ViewBuilder var content: () -> Content

    var body: some View {
        content()
            .background(Theme.surface)
            .clipShape(RoundedRectangle(cornerRadius: radius, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: radius, style: .continuous)
                    .stroke(Theme.hairline, lineWidth: 1)
            )
    }
}

/// The primary call to action: a flat accent fill at the row height, nothing under it.
///
/// `isBusy` swaps the label for a spinner in place rather than disabling into ambiguity, so
/// the button never changes size mid-tap.
struct PrimaryButton: View {
    let title: String
    var isBusy: Bool = false
    var isEnabled: Bool = true
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            ZStack {
                Text(title)
                    .font(.system(.subheadline).weight(.semibold))
                    .opacity(isBusy ? 0 : 1)
                if isBusy {
                    ProgressView().tint(Theme.accentContrast)
                }
            }
            .foregroundStyle(Theme.accentContrast)
            .frame(maxWidth: .infinity)
            .frame(minHeight: Theme.rowHeight)
            .background(Theme.accent.opacity(isEnabled && !isBusy ? 1 : 0.55))
            .clipShape(RoundedRectangle(cornerRadius: Theme.Radius.lg, style: .continuous))
        }
        .buttonStyle(PressableStyle())
        .disabled(!isEnabled || isBusy)
    }
}

/// A secondary action: bordered, on the surface colour, the same height as the primary.
struct SecondaryButton: View {
    let title: String
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Text(title)
                .font(.system(.subheadline).weight(.medium))
                .foregroundStyle(Theme.textPrimary)
                .frame(maxWidth: .infinity)
                .frame(minHeight: Theme.rowHeight)
                .background(Theme.surface)
                .clipShape(RoundedRectangle(cornerRadius: Theme.Radius.lg, style: .continuous))
                .overlay(
                    RoundedRectangle(cornerRadius: Theme.Radius.lg, style: .continuous)
                        .stroke(Theme.border, lineWidth: 1)
                )
        }
        .buttonStyle(PressableStyle())
    }
}

/// A field on the page.
///
/// `prompt:` rather than the bare `TextField("Email", …)` label, because only the prompt form
/// lets the placeholder colour be set — the default is near-invisible here.
struct DarkFieldStyle: ViewModifier {
    func body(content: Content) -> some View {
        content
            .font(.system(.body))
            .foregroundStyle(Theme.textPrimary)
            .tint(Theme.accentBright)
            .padding(.horizontal, Theme.Space.md)
            .padding(.vertical, Theme.Space.md)
            // The fill is drawn *behind* the text rather than clipped around it. `.clipShape`
            // on the field itself trims whatever does not fit the padded frame, so at larger
            // Dynamic Type sizes the text was cut off inside its own box — which the
            // accessibility audit reports as "Text clipped". A background shape has no such
            // effect: the field grows and the text stays whole.
            .background(
                RoundedRectangle(cornerRadius: Theme.Radius.lg, style: .continuous)
                    .fill(Theme.fieldFill)
            )
            .overlay(
                RoundedRectangle(cornerRadius: Theme.Radius.lg, style: .continuous)
                    .stroke(Theme.border, lineWidth: 1)
            )
    }
}

extension View {
    func darkField() -> some View { modifier(DarkFieldStyle()) }
}

/// A property pill: an icon and a value, bordered, at the pill height. The detail screen's
/// status, priority and assignee are these; so are the composer's.
struct PropertyChip<Icon: View>: View {
    let text: String
    var tint: Color = Theme.textPrimary
    @ViewBuilder var icon: () -> Icon

    var body: some View {
        HStack(spacing: Theme.Space.xs + 2) {
            icon()
            Text(text)
                .font(.system(.footnote).weight(.medium))
                .foregroundStyle(tint)
                .lineLimit(1)
        }
        .padding(.horizontal, Theme.Space.sm + 2)
        .frame(minHeight: 30)
        .background(Theme.surface)
        .clipShape(RoundedRectangle(cornerRadius: Theme.Radius.md, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: Theme.Radius.md, style: .continuous)
                .stroke(Theme.border, lineWidth: 1)
        )
        .contentShape(Rectangle())
    }
}

/// The Polaris mark: a flat accent tile with the star cut into it.
///
/// It breathes very slightly — two off-phase loops rather than one, so it does not read as a
/// progress indicator — and it holds still under Reduce Motion, because a permanently-moving
/// element is precisely what that setting exists to stop. No glow: a shadow that leaks onto
/// the copy beneath is the one thing a welcome screen cannot afford.
struct PolarisMark: View {
    var size: CGFloat = 64
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var breathe = false

    var body: some View {
        RoundedRectangle(cornerRadius: size * 0.22, style: .continuous)
            .fill(Theme.accent)
            .frame(width: size, height: size)
            .overlay(
                Image(systemName: "sparkle")
                    .font(.system(size: size * 0.42, weight: .medium))
                    .foregroundStyle(Theme.accentContrast)
            )
            .scaleEffect(breathe ? 1.03 : 1)
            .animation(
                reduceMotion ? nil : .easeInOut(duration: 3.4).repeatForever(autoreverses: true),
                value: breathe
            )
            .accessibilityHidden(true)
            .onAppear {
                // Under Reduce Motion this stays false: the animation is nil there, so setting
                // it would snap the tile to its end scale rather than hold it still.
                guard !reduceMotion else { return }
                breathe = true
            }
    }
}

/// Lays its children out left to right and wraps to a new line when the width runs out.
///
/// For the property chips on the detail screen and the pills in the composer: a fixed grid
/// would leave holes where a chip is absent, and an `HStack` would push the last chip off
/// the edge on a narrow phone.
struct FlowLayout: Layout {
    var spacing: CGFloat = Theme.Space.sm

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let width = proposal.width ?? .infinity
        return place(in: width, subviews: subviews).size
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        let layout = place(in: bounds.width, subviews: subviews)
        for (subview, origin) in zip(subviews, layout.origins) {
            subview.place(
                at: CGPoint(x: bounds.minX + origin.x, y: bounds.minY + origin.y),
                proposal: .unspecified
            )
        }
    }

    private func place(in width: CGFloat, subviews: Subviews) -> (size: CGSize, origins: [CGPoint]) {
        var origins: [CGPoint] = []
        var x: CGFloat = 0
        var y: CGFloat = 0
        var lineHeight: CGFloat = 0
        var maxX: CGFloat = 0
        for subview in subviews {
            let size = subview.sizeThatFits(.unspecified)
            if x > 0, x + size.width > width {
                x = 0
                y += lineHeight + spacing
                lineHeight = 0
            }
            origins.append(CGPoint(x: x, y: y))
            lineHeight = max(lineHeight, size.height)
            x += size.width + spacing
            maxX = max(maxX, x - spacing)
        }
        return (CGSize(width: maxX, height: y + lineHeight), origins)
    }
}
