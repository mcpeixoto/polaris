import SwiftUI

/// Points, zero to eight, or none.
///
/// A flat list rather than a stepper: a stepper is nine taps from nothing to eight and
/// offers no way to say "no estimate", which is a different fact from zero.
struct EstimatePicker: View {
    let selected: Int?
    let onPick: (Int?) -> Void
    @Environment(\.dismiss) private var dismiss

    static let scale = Array(0...8)

    var body: some View {
        NavigationStack {
            List {
                Button {
                    onPick(nil)
                    dismiss()
                } label: {
                    row(text: String(localized: "No estimate"), isSelected: selected == nil)
                }
                .listRowBackground(Color.clear)
                .listRowSeparatorTint(Theme.hairline)
                .accessibilityIdentifier("estimatePicker.none")

                ForEach(Self.scale, id: \.self) { points in
                    Button {
                        onPick(points)
                        dismiss()
                    } label: {
                        row(text: points == 1 ? "1 point" : "\(points) points", isSelected: points == selected)
                    }
                    .listRowBackground(Color.clear)
                    .listRowSeparatorTint(Theme.hairline)
                    .accessibilityIdentifier("estimatePicker.option.\(points)")
                }
            }
            .listStyle(.plain)
            .scrollContentBackground(.hidden)
            .background(Theme.background)
            .navigationTitle(Text("Estimate"))
            .navigationBarTitleDisplayMode(.inline)
        }
        .presentationDetents([.medium, .large])
        .presentationDragIndicator(.visible)
    }

    private func row(text: String, isSelected: Bool) -> some View {
        HStack(spacing: Theme.Space.md) {
            Image(systemName: "number")
                .font(.system(size: 13))
                .foregroundStyle(Theme.textSecondary)
                .frame(width: 18)
                .accessibilityHidden(true)
            Text(text)
                .font(PolarisText.body.monospacedDigit())
                .foregroundStyle(Theme.textPrimary)
            Spacer(minLength: 0)
            if isSelected {
                Image(systemName: "checkmark")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(Theme.accentBright)
            }
        }
        .frame(minHeight: Theme.rowHeight - Theme.Space.lg)
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(isSelected ? [.isSelected] : [])
    }
}
