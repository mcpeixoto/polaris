import Foundation

/// One block of a description, as the editor wrote it.
///
/// `AttributedString(markdown:)` handles emphasis, code spans and links, and nothing else:
/// it flattens a heading into a paragraph, a list into a run of dashes, and a fenced block
/// into inline text. Those are the four things a description written on the web actually
/// uses, so the block structure is parsed here and only the inline styling is left to
/// Foundation.
enum MarkdownBlock: Equatable {
    struct ListItem: Equatable {
        let text: String
        /// Nil for a plain bullet, true or false for a task box.
        let checked: Bool?
    }

    case heading(level: Int, text: String)
    case paragraph(String)
    case list(items: [ListItem], ordered: Bool)
    case quote(String)
    case code(String, language: String?)
}

/// A small, line-based parser for the subset of Markdown the description editor produces.
///
/// It is deliberately not a CommonMark implementation. Nested lists, tables, setext
/// headings and reference links are not in the editor, so a parser that handled them would
/// be code nobody can exercise. Anything it does not recognise stays a paragraph, which is
/// the failure mode that loses nothing.
enum MarkdownBlockParser {
    static func parse(_ source: String) -> [MarkdownBlock] {
        let lines = source.replacingOccurrences(of: "\r\n", with: "\n").split(
            separator: "\n", omittingEmptySubsequences: false
        ).map(String.init)
        var blocks: [MarkdownBlock] = []
        var index = 0

        while index < lines.count {
            let line = lines[index]
            let trimmed = line.trimmingCharacters(in: .whitespaces)

            if trimmed.isEmpty {
                index += 1
                continue
            }

            // Fenced code runs to the closing fence, or to the end when the writer forgot one
            // — an open fence swallowing the rest of the text is what every renderer does.
            if trimmed.hasPrefix("```") {
                let language = trimmed.dropFirst(3).trimmingCharacters(in: .whitespaces)
                var body: [String] = []
                index += 1
                while index < lines.count, !lines[index].trimmingCharacters(in: .whitespaces).hasPrefix("```") {
                    body.append(lines[index])
                    index += 1
                }
                index += 1
                blocks.append(.code(body.joined(separator: "\n"), language: language.isEmpty ? nil : language))
                continue
            }

            if let heading = heading(trimmed) {
                blocks.append(heading)
                index += 1
                continue
            }

            if trimmed.hasPrefix(">") {
                var quoted: [String] = []
                while index < lines.count {
                    let candidate = lines[index].trimmingCharacters(in: .whitespaces)
                    guard candidate.hasPrefix(">") else { break }
                    quoted.append(stripQuoteMarker(candidate))
                    index += 1
                }
                blocks.append(.quote(quoted.joined(separator: "\n")))
                continue
            }

            if let first = listItem(trimmed) {
                var items = [first.item]
                index += 1
                while index < lines.count, let next = listItem(lines[index].trimmingCharacters(in: .whitespaces)),
                      next.ordered == first.ordered {
                    items.append(next.item)
                    index += 1
                }
                blocks.append(.list(items: items, ordered: first.ordered))
                continue
            }

            // A paragraph is every line up to the next blank one or the next block marker.
            // Soft line breaks are kept: a description written on the web wraps where the
            // writer pressed return, and joining the lines would run two short notes into one.
            var paragraph = [trimmed]
            index += 1
            while index < lines.count {
                let candidate = lines[index].trimmingCharacters(in: .whitespaces)
                if candidate.isEmpty || candidate.hasPrefix("```") || candidate.hasPrefix(">")
                    || heading(candidate) != nil || listItem(candidate) != nil {
                    break
                }
                paragraph.append(candidate)
                index += 1
            }
            blocks.append(.paragraph(paragraph.joined(separator: "\n")))
        }
        return blocks
    }

    /// `#`, `##` or `###` followed by a space. Four or more hashes are not a heading level the
    /// editor offers, so they stay text — as does `#hashtag`, which has no space after it.
    private static func heading(_ line: String) -> MarkdownBlock? {
        var level = 0
        var rest = Substring(line)
        while rest.first == "#", level < 4 {
            level += 1
            rest = rest.dropFirst()
        }
        guard (1...3).contains(level), rest.first == " " else { return nil }
        let text = rest.trimmingCharacters(in: .whitespaces)
        return text.isEmpty ? nil : .heading(level: level, text: text)
    }

    private static func listItem(_ line: String) -> (item: MarkdownBlock.ListItem, ordered: Bool)? {
        if line.hasPrefix("- ") || line.hasPrefix("* ") || line.hasPrefix("+ ") {
            let body = line.dropFirst(2).trimmingCharacters(in: .whitespaces)
            if body.hasPrefix("[ ] ") || body == "[ ]" {
                return (.init(text: body.dropFirst(3).trimmingCharacters(in: .whitespaces), checked: false), false)
            }
            if body.lowercased().hasPrefix("[x] ") || body.lowercased() == "[x]" {
                return (.init(text: body.dropFirst(3).trimmingCharacters(in: .whitespaces), checked: true), false)
            }
            return (.init(text: body, checked: nil), false)
        }
        // `1. ` through any number of digits; the number itself is ignored, as CommonMark does,
        // so a list that was reordered by hand still counts from one.
        var digits = 0
        var rest = Substring(line)
        while let first = rest.first, first.isNumber {
            digits += 1
            rest = rest.dropFirst()
        }
        guard digits > 0, rest.hasPrefix(". ") || rest.hasPrefix(") ") else { return nil }
        let body = rest.dropFirst(2).trimmingCharacters(in: .whitespaces)
        return (.init(text: body, checked: nil), true)
    }

    private static func stripQuoteMarker(_ line: String) -> String {
        var rest = Substring(line).dropFirst()
        if rest.first == " " { rest = rest.dropFirst() }
        return String(rest)
    }
}
