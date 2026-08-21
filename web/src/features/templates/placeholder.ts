/**
 * Aa placeholder marks in a template body.
 *
 * Linear's toolbar wraps selected text so the filer sees a prompt rather than finished
 * copy. The marks are a pair of lenticular brackets that almost never appear in ordinary
 * markdown, so a description that was not written as a template is left alone.
 */

export const PLACEHOLDER_OPEN = '⟦';
export const PLACEHOLDER_CLOSE = '⟧';

const PLACEHOLDER_RE = /⟦([^⟦⟧]*)⟧/g;

export interface PlaceholderSpan {
  readonly start: number;
  readonly end: number;
  readonly text: string;
}

export function wrapPlaceholder(text: string): string {
  return `${PLACEHOLDER_OPEN}${text}${PLACEHOLDER_CLOSE}`;
}

export function unwrapPlaceholders(body: string): string {
  return body.replace(PLACEHOLDER_RE, '$1');
}

export function placeholderSpans(body: string): readonly PlaceholderSpan[] {
  const spans: PlaceholderSpan[] = [];
  const re = new RegExp(PLACEHOLDER_RE.source, 'g');
  let match: RegExpExecArray | null;
  while ((match = re.exec(body)) !== null) {
    spans.push({ start: match.index, end: match.index + match[0].length, text: match[1] ?? '' });
  }
  return spans;
}

/**
 * Wraps the selection as a placeholder, or unwraps it if it is already one.
 *
 * The returned caret sits around the (un)wrapped span so a second press undoes the first.
 */
export function togglePlaceholder(
  body: string,
  start: number,
  end: number,
): { readonly body: string; readonly start: number; readonly end: number } {
  const from = Math.min(start, end);
  const to = Math.max(start, end);
  if (from === to) return { body, start: from, end: to };

  const selected = body.slice(from, to);
  if (selected.startsWith(PLACEHOLDER_OPEN) && selected.endsWith(PLACEHOLDER_CLOSE)) {
    const inner = selected.slice(
      PLACEHOLDER_OPEN.length,
      selected.length - PLACEHOLDER_CLOSE.length,
    );
    return {
      body: body.slice(0, from) + inner + body.slice(to),
      start: from,
      end: from + inner.length,
    };
  }

  const wrapped = wrapPlaceholder(selected);
  return {
    body: body.slice(0, from) + wrapped + body.slice(to),
    start: from,
    end: from + wrapped.length,
  };
}
