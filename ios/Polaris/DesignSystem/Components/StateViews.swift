import SwiftUI
import PolarisCore

/// The three things that are not content: nothing yet, nothing at all, and something broke.
/// Centralised because they are the screens most often written twice and inconsistently.

struct LoadingView: View {
    var label: String = "Loading"

    var body: some View {
        VStack(spacing: 12) {
            ProgressView()
            Text(label)
                .font(TypeScale.rowMeta)
                .foregroundStyle(Theme.secondaryText)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        // One announcement for the whole state, rather than VoiceOver reading a bare spinner.
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(label)
    }
}

struct EmptyStateView: View {
    let symbol: String
    let title: String
    let message: String
    var actionTitle: String?
    var action: (() -> Void)?

    var body: some View {
        VStack(spacing: 12) {
            Image(systemName: symbol)
                .font(.system(size: 40))
                .foregroundStyle(Theme.secondaryText)
                .accessibilityHidden(true)
            Text(title)
                .font(TypeScale.sectionTitle)
                .foregroundStyle(Theme.primaryText)
            Text(message)
                .font(TypeScale.rowMeta)
                .foregroundStyle(Theme.secondaryText)
                .multilineTextAlignment(.center)
            if let actionTitle, let action {
                Button(actionTitle, action: action)
                    .buttonStyle(.borderedProminent)
                    .padding(.top, 4)
            }
        }
        .padding(32)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

struct ErrorStateView: View {
    let error: PolarisError
    var retry: (() -> Void)?

    var body: some View {
        VStack(spacing: 12) {
            Image(systemName: "exclamationmark.triangle")
                .font(.system(size: 36))
                .foregroundStyle(.orange)
                .accessibilityHidden(true)
            Text(error.displayMessage)
                .font(TypeScale.body)
                .foregroundStyle(Theme.primaryText)
                .multilineTextAlignment(.center)
            // A retry button on a validation error is a lie — it would fail identically.
            if error.isRetryable, let retry {
                Button("Try again", action: retry)
                    .buttonStyle(.bordered)
            }
        }
        .padding(32)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}
