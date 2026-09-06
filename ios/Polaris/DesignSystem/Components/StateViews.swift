import SwiftUI
import PolarisCore

/// The three things that are not content: nothing yet, nothing at all, and something broke.
/// Centralised because they are the screens most often written twice and inconsistently.

struct LoadingView: View {
    var label: String = "Loading"

    var body: some View {
        VStack(spacing: Theme.Space.md) {
            ProgressView()
                .tint(Theme.textSecondary)
            Text(label)
                .font(PolarisText.caption)
                .foregroundStyle(Theme.textSecondary)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        // One announcement for the whole state, rather than VoiceOver reading a bare spinner.
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(label)
    }
}

/// An empty collection, said quietly in the middle of the space it would have filled. No
/// box around it: a bordered slot draws the eye to the absence, and the absence is not the
/// point — the action under it is.
struct EmptyStateView: View {
    let symbol: String
    let title: String
    let message: String
    var actionTitle: String?
    var action: (() -> Void)?

    var body: some View {
        VStack(spacing: Theme.Space.sm) {
            Group {
                Image(systemName: symbol)
                    .font(.system(size: 26, weight: .light))
                    .foregroundStyle(Theme.textTertiary)
                    .padding(.bottom, Theme.Space.xs)
                    // Inside the combined group, VoiceOver announced the SF Symbol's name
                    // ahead of the title. Its siblings — ErrorStateView, InlineErrorLabel —
                    // both hide theirs.
                    .accessibilityHidden(true)
                Text(title)
                    .font(.system(.subheadline).weight(.semibold))
                    .foregroundStyle(Theme.textPrimary)
                Text(message)
                    .font(PolarisText.caption)
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
                        .font(.system(.footnote).weight(.medium))
                        .foregroundStyle(Theme.textPrimary)
                        .padding(.horizontal, Theme.Space.md)
                        .frame(minHeight: 30)
                        .background(Theme.surface)
                        .clipShape(RoundedRectangle(cornerRadius: Theme.Radius.md, style: .continuous))
                        .overlay(
                            RoundedRectangle(cornerRadius: Theme.Radius.md, style: .continuous)
                                .stroke(Theme.border, lineWidth: 1)
                        )
                        .hitTarget(minWidth: 0)
                }
                .buttonStyle(PressableStyle())
                .padding(.top, Theme.Space.xs)
            }
        }
        .frame(maxWidth: .infinity)
        .padding(.horizontal, Theme.Space.xxl)
        .padding(.vertical, Theme.Space.xxxl)
    }
}

struct ErrorStateView: View {
    let error: PolarisError
    var retry: (() -> Void)?

    var body: some View {
        VStack(spacing: Theme.Space.md) {
            Image(systemName: "exclamationmark.triangle")
                .font(.system(size: 26, weight: .light))
                .foregroundStyle(Theme.warn)
                .accessibilityHidden(true)
            Text(error.displayMessage)
                .font(PolarisText.body)
                .foregroundStyle(Theme.textPrimary)
                .multilineTextAlignment(.center)
                .lineSpacing(2)
                .fixedSize(horizontal: false, vertical: true)
            // A retry button on a validation error is a lie — it would fail identically.
            if error.isRetryable, let retry {
                Button(action: retry) {
                    Text("Try again")
                        .font(.system(.footnote).weight(.medium))
                        .foregroundStyle(Theme.textPrimary)
                        .padding(.horizontal, Theme.Space.md)
                        .frame(minHeight: 30)
                        .background(Theme.surface)
                        .clipShape(RoundedRectangle(cornerRadius: Theme.Radius.md, style: .continuous))
                        .overlay(
                            RoundedRectangle(cornerRadius: Theme.Radius.md, style: .continuous)
                                .stroke(Theme.border, lineWidth: 1)
                        )
                        .hitTarget(minWidth: 0)
                }
                .buttonStyle(PressableStyle())
            }
        }
        .padding(Theme.Space.xxxl)
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
        HStack(alignment: .top, spacing: Theme.Space.sm) {
            Image(systemName: "exclamationmark.circle.fill")
                .font(.system(size: 12))
                .foregroundStyle(Theme.danger)
                .padding(.top, 1)
                .accessibilityHidden(true)
            Text(text)
                .font(.system(.footnote).weight(.medium))
                .foregroundStyle(Theme.danger)
                .fixedSize(horizontal: false, vertical: true)
                .multilineTextAlignment(.leading)
            if let retryLabel, let onRetry {
                Button(action: onRetry) {
                    Text(retryLabel)
                        .font(.system(.footnote).weight(.semibold))
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
