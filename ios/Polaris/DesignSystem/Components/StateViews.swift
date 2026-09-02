import SwiftUI
import PolarisCore

/// The three things that are not content: nothing yet, nothing at all, and something broke.
/// Centralised because they are the screens most often written twice and inconsistently.

struct LoadingView: View {
    var label: String = "Loading"

    var body: some View {
        VStack(spacing: 14) {
            ProgressView()
                .tint(Theme.accentBright)
            Text(label)
                .bodyFont(13, weight: .medium)
                .foregroundStyle(Theme.textSecondary)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        // One announcement for the whole state, rather than VoiceOver reading a bare spinner.
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(label)
    }
}

/// A dashed border over a translucent fill, so an empty collection reads as "nothing here
/// yet" rather than as an error. A solid card says something went wrong; a dashed slot says
/// something is missing.
struct EmptyStateView: View {
    let symbol: String
    let title: String
    let message: String
    var actionTitle: String?
    var action: (() -> Void)?

    var body: some View {
        VStack(spacing: 8) {
            Group {
                Image(systemName: symbol)
                    .font(.system(size: 30, weight: .light))
                    .foregroundStyle(Theme.accentBright.opacity(0.8))
                    .padding(.bottom, 2)
                    // Inside the combined group, VoiceOver announced the SF Symbol's name
                    // ahead of the title. Its siblings — ErrorStateView, InlineErrorLabel —
                    // both hide theirs.
                    .accessibilityHidden(true)
                Text(title)
                    .displayFont(20)
                    .foregroundStyle(Theme.textPrimary)
                Text(message)
                    .bodyFont(12.5)
                    .foregroundStyle(Theme.textSecondary)
                    .multilineTextAlignment(.center)
                    .lineSpacing(2)
                    .fixedSize(horizontal: false, vertical: true)
            }
            // The action stays a sibling so it is not swallowed into the combined static text.
            .accessibilityElement(children: .combine)

            if let actionTitle, let action {
                Button(action: action) {
                    Text(actionTitle)
                        .bodyFont(12.5, weight: .semibold)
                        .foregroundStyle(.white)
                        .padding(.horizontal, 16)
                        .padding(.vertical, 10)
                        .background(Theme.accent)
                        .clipShape(Capsule())
                        .hitTarget(minWidth: 0)
                }
                .buttonStyle(PressableStyle())
                .padding(.top, 6)
            }
        }
        .frame(maxWidth: .infinity)
        .padding(.horizontal, 24)
        .padding(.vertical, 30)
        .background(Theme.card)
        .clipShape(RoundedRectangle(cornerRadius: 20, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 20, style: .continuous)
                .strokeBorder(Theme.border, style: StrokeStyle(lineWidth: 1.5, dash: [4, 4]))
        )
    }
}

struct ErrorStateView: View {
    let error: PolarisError
    var retry: (() -> Void)?

    var body: some View {
        VStack(spacing: 12) {
            Image(systemName: "exclamationmark.triangle")
                .font(.system(size: 30, weight: .light))
                .foregroundStyle(Theme.warn)
                .accessibilityHidden(true)
            Text(error.displayMessage)
                .bodyFont(14)
                .foregroundStyle(Theme.textPrimary)
                .multilineTextAlignment(.center)
                .lineSpacing(2)
                .fixedSize(horizontal: false, vertical: true)
            // A retry button on a validation error is a lie — it would fail identically.
            if error.isRetryable, let retry {
                Button(action: retry) {
                    Text("Try again")
                        .bodyFont(12.5, weight: .semibold)
                        .foregroundStyle(Theme.textPrimary)
                        .padding(.horizontal, 18)
                        .padding(.vertical, 10)
                        .background(Theme.card)
                        .clipShape(Capsule())
                        .overlay(Capsule().stroke(Theme.border, lineWidth: 1))
                        .hitTarget(minWidth: 0)
                }
                .buttonStyle(PressableStyle())
            }
        }
        .padding(32)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

/// An error said next to the thing that failed, not in a banner.
///
/// A greyed-out button on its own leaves somebody guessing which field is wrong; this is the
/// sentence that answers that, and it sits under the field it is about.
struct InlineErrorLabel: View {
    let text: String
    var retryLabel: String?
    var onRetry: (() -> Void)?

    var body: some View {
        HStack(alignment: .top, spacing: 8) {
            Image(systemName: "exclamationmark.circle.fill")
                .font(.system(size: 12))
                .foregroundStyle(Theme.danger)
                .padding(.top, 1)
                .accessibilityHidden(true)
            Text(text)
                .bodyFont(12.5, weight: .medium)
                .foregroundStyle(Theme.danger)
                .fixedSize(horizontal: false, vertical: true)
                .multilineTextAlignment(.leading)
            if let retryLabel, let onRetry {
                Button(action: onRetry) {
                    Text(retryLabel)
                        .bodyFont(12.5, weight: .semibold)
                        .underline()
                        .foregroundStyle(Theme.accentBright)
                }
                .buttonStyle(.plain)
            }
        }
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(.isStaticText)
        // Drawn is not the same as announced. Focus stays on the button the reader just
        // pressed, so without this a VoiceOver user presses Sign in and hears nothing at all.
        // `.high`, because the layout change that accompanies the error posts its own
        // notification first and drops a default-priority announcement.
        .onAppear {
            var speech = AttributedString(text)
            speech.accessibilitySpeechAnnouncementPriority = .high
            AccessibilityNotification.Announcement(speech).post()
        }
    }
}
