import SwiftUI

/// A calendar day, chosen on a calendar.
///
/// The value in and out is the wire string — `2026-09-12`, no timezone — read and written
/// in the reader's calendar, for the reason `DueDateFormat` gives: a deadline of the 12th
/// is the 12th wherever the reader is. Save is explicit, so scrolling through months does
/// not mint a write per tap.
struct DatePickerSheet: View {
    let title: String
    let selected: String?
    let onPick: (String?) -> Void
    @Environment(\.dismiss) private var dismiss
    @Environment(\.calendar) private var calendar
    @State private var draft: Date

    init(title: String, selected: String?, onPick: @escaping (String?) -> Void) {
        self.title = title
        self.selected = selected
        self.onPick = onPick
        let initial = selected.flatMap { DueDateFormat.day($0, calendar: .current) } ?? .now
        _draft = State(initialValue: initial)
    }

    var body: some View {
        NavigationStack {
            ZStack {
                Theme.background.ignoresSafeArea()
                VStack(spacing: Theme.Space.lg) {
                    DatePicker(
                        "",
                        selection: $draft,
                        displayedComponents: .date
                    )
                    .datePickerStyle(.graphical)
                    .tint(Theme.accentBright)
                    .labelsHidden()
                    .accessibilityIdentifier("datePicker.calendar")

                    if selected != nil {
                        Button(role: .destructive) {
                            onPick(nil)
                            dismiss()
                        } label: {
                            Text("Clear")
                                .font(.system(.subheadline).weight(.medium))
                                .foregroundStyle(Theme.danger)
                                .frame(maxWidth: .infinity)
                                .frame(minHeight: Theme.rowHeight)
                        }
                        .buttonStyle(PressableStyle())
                        .accessibilityIdentifier("datePicker.clear")
                    }
                    Spacer(minLength: 0)
                }
                .padding(.horizontal, Theme.Space.lg)
                .padding(.top, Theme.Space.sm)
            }
            .navigationTitle(Text(title))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button { dismiss() } label: { Text("Cancel") }
                        .tint(Theme.textSecondary)
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button {
                        onPick(Self.dayString(draft, calendar: calendar))
                        dismiss()
                    } label: {
                        Text("Save").font(.system(.body).weight(.semibold))
                    }
                    .tint(Theme.accentBright)
                    .accessibilityIdentifier("datePicker.save")
                }
            }
        }
        .presentationDetents([.medium, .large])
        .presentationDragIndicator(.visible)
    }

    /// `2026-09-12` for a date, in the given calendar. Zero-padded by hand rather than through
    /// a `DateFormatter`, which would apply the device locale's numbering to a wire format.
    static func dayString(_ date: Date, calendar: Calendar) -> String {
        let parts = calendar.dateComponents([.year, .month, .day], from: date)
        let year = parts.year ?? 1970
        let month = parts.month ?? 1
        let day = parts.day ?? 1
        return String(format: "%04d-%02d-%02d", year, month, day)
    }
}
