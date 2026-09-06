import SwiftUI

/// A description, rendered block by block.
///
/// Block structure comes from `MarkdownBlockParser`; the inline styling inside each block —
/// emphasis, code spans, links — is Foundation's. Links open through the environment's
/// `openURL`, which is Safari unless a parent decides otherwise.
struct MarkdownView: View {
    let source: String

    var body: some View {
        let blocks = MarkdownBlockParser.parse(source)
        VStack(alignment: .leading, spacing: Theme.Space.sm + 2) {
            ForEach(Array(blocks.enumerated()), id: \.offset) { _, block in
                view(for: block)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    @ViewBuilder
    private func view(for block: MarkdownBlock) -> some View {
        switch block {
        case .heading(let level, let text):
            InlineMarkdown(text)
                .font(headingFont(level))
                .foregroundStyle(Theme.textPrimary)
                .padding(.top, level == 1 ? Theme.Space.xs : 0)

        case .paragraph(let text):
            InlineMarkdown(text)
                .font(PolarisText.body)
                .foregroundStyle(Theme.textPrimary)
                .lineSpacing(3)

        case .list(let items, let ordered):
            VStack(alignment: .leading, spacing: Theme.Space.xs) {
                ForEach(Array(items.enumerated()), id: \.offset) { index, item in
                    HStack(alignment: .firstTextBaseline, spacing: Theme.Space.sm) {
                        marker(for: item, index: index, ordered: ordered)
                        InlineMarkdown(item.text)
                            .font(PolarisText.body)
                            .foregroundStyle(item.checked == true ? Theme.textTertiary : Theme.textPrimary)
                            .strikethrough(item.checked == true, color: Theme.textTertiary)
                            .lineSpacing(3)
                    }
                }
            }

        case .quote(let text):
            HStack(alignment: .top, spacing: Theme.Space.md) {
                RoundedRectangle(cornerRadius: 1, style: .continuous)
                    .fill(Theme.border)
                    .frame(width: 2)
                InlineMarkdown(text)
                    .font(PolarisText.body)
                    .foregroundStyle(Theme.textSecondary)
                    .lineSpacing(3)
            }
            .fixedSize(horizontal: false, vertical: true)

        case .code(let text, _):
            ScrollView(.horizontal, showsIndicators: false) {
                Text(text)
                    .font(.system(.footnote, design: .monospaced))
                    .foregroundStyle(Theme.textPrimary)
                    .padding(Theme.Space.md)
            }
            .background(Theme.surface)
            .clipShape(RoundedRectangle(cornerRadius: Theme.Radius.md, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: Theme.Radius.md, style: .continuous)
                    .stroke(Theme.hairline, lineWidth: 1)
            )
        }
    }

    private func headingFont(_ level: Int) -> Font {
        switch level {
        case 1: .system(.title3).weight(.semibold)
        case 2: .system(.headline).weight(.semibold)
        default: .system(.subheadline).weight(.semibold)
        }
    }

    @ViewBuilder
    private func marker(for item: MarkdownBlock.ListItem, index: Int, ordered: Bool) -> some View {
        if let checked = item.checked {
            // Read-only on purpose: ticking a box here would be a description edit, and the
            // description is edited in its own sheet with an explicit Save.
            Image(systemName: checked ? "checkmark.square.fill" : "square")
                .font(.system(size: 13))
                .foregroundStyle(checked ? Theme.accentBright : Theme.textTertiary)
                .frame(width: 18, alignment: .center)
                .accessibilityLabel(Text(checked ? "Done" : "Not done"))
        } else if ordered {
            Text("\(index + 1).")
                .font(PolarisText.body.monospacedDigit())
                .foregroundStyle(Theme.textSecondary)
                .frame(minWidth: 18, alignment: .trailing)
        } else {
            Text("•")
                .font(PolarisText.body)
                .foregroundStyle(Theme.textSecondary)
                .frame(width: 18, alignment: .center)
        }
    }
}

/// One run of inline Markdown as a `Text`.
///
/// `inlineOnlyPreservingWhitespace` keeps the soft line breaks the parser left in a
/// paragraph; the default option collapses them, which is right for HTML and wrong for a
/// note somebody typed on a phone. A string Foundation refuses is shown as it was typed —
/// an unbalanced asterisk must not blank the description.
private struct InlineMarkdown: View {
    let text: String

    init(_ text: String) { self.text = text }

    var body: some View {
        Text(attributed)
            .fixedSize(horizontal: false, vertical: true)
            .frame(maxWidth: .infinity, alignment: .leading)
            .multilineTextAlignment(.leading)
            .tint(Theme.accentBright)
    }

    private var attributed: AttributedString {
        let options = AttributedString.MarkdownParsingOptions(
            interpretedSyntax: .inlineOnlyPreservingWhitespace
        )
        return (try? AttributedString(markdown: text, options: options)) ?? AttributedString(text)
    }
}
