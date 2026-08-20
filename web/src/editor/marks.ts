/**
 * Comment marks on a markdown description.
 *
 * The description is still a string of markdown — the rich editor is a later slice — so a
 * comment cannot live *in* the text the way a ProseMirror mark would. It lives beside it:
 * start/end offsets as a textarea reports them (UTF-16), plus the selected quote so a later
 * edit can re-find the span when those offsets drift.
 *
 * Painting is a sweep over the re-anchored spans: overlapping comments share a segment, and
 * a click on a caret offset hits the shortest span covering it, which is the most specific
 * of the nested ones.
 */

export interface CommentAnchor {
  readonly id: string;
  readonly start: number;
  readonly end: number;
  readonly quote: string;
  readonly resolved: boolean;
}

export interface PlacedAnchor extends CommentAnchor {
  readonly start: number;
  readonly end: number;
}

export interface TextSegment {
  readonly text: string;
  readonly commentIds: readonly string[];
  readonly resolved: boolean;
}

/** Re-find a span in `text`. Returns null when the quote is gone. */
export function reanchor(
  text: string,
  start: number,
  end: number,
  quote: string,
): { start: number; end: number } | null {
  if (quote === '') return null;
  if (start >= 0 && end <= text.length && end > start && text.slice(start, end) === quote) {
    return { start, end };
  }
  let best: { start: number; end: number } | null = null;
  let bestDist = Infinity;
  let from = 0;
  while (from <= text.length) {
    const found = text.indexOf(quote, from);
    if (found === -1) break;
    const dist = Math.abs(found - start);
    if (dist < bestDist) {
      bestDist = dist;
      best = { start: found, end: found + quote.length };
    }
    from = found + 1;
  }
  return best;
}

export function placeAnchors(text: string, anchors: readonly CommentAnchor[]): PlacedAnchor[] {
  const out: PlacedAnchor[] = [];
  for (const anchor of anchors) {
    const placed = reanchor(text, anchor.start, anchor.end, anchor.quote);
    if (placed === null) continue;
    out.push({ ...anchor, start: placed.start, end: placed.end });
  }
  return out;
}

/**
 * Split `text` into runs tagged with the comments covering each run. Adjacent unmarked
 * characters stay one run; a boundary is only introduced where coverage changes.
 */
export function paint(text: string, anchors: readonly PlacedAnchor[]): TextSegment[] {
  if (text === '') return [{ text: '', commentIds: [], resolved: false }];
  if (anchors.length === 0) return [{ text, commentIds: [], resolved: false }];

  const bounds = new Set<number>([0, text.length]);
  for (const anchor of anchors) {
    bounds.add(Math.max(0, Math.min(text.length, anchor.start)));
    bounds.add(Math.max(0, Math.min(text.length, anchor.end)));
  }
  const points = [...bounds].sort((a, b) => a - b);
  const segments: TextSegment[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const from = points[i]!;
    const to = points[i + 1]!;
    if (from === to) continue;
    const covering = anchors.filter((anchor) => anchor.start <= from && anchor.end >= to);
    const commentIds = covering.map((anchor) => anchor.id);
    const resolved = covering.length > 0 && covering.every((anchor) => anchor.resolved);
    segments.push({ text: text.slice(from, to), commentIds, resolved });
  }
  return segments;
}

/** The most specific (shortest) comment covering `offset`, or null. */
export function hitTest(offset: number, anchors: readonly PlacedAnchor[]): string | null {
  const covering = anchors.filter((anchor) => offset >= anchor.start && offset < anchor.end);
  if (covering.length === 0) {
    const atEnd = anchors.filter((anchor) => offset === anchor.end && anchor.end > anchor.start);
    if (atEnd.length === 0) return null;
    atEnd.sort((a, b) => a.end - a.start - (b.end - b.start));
    return atEnd[0]!.id;
  }
  covering.sort((a, b) => a.end - a.start - (b.end - b.start));
  return covering[0]!.id;
}

export function isInlineRoot(comment: {
  quote?: string | undefined;
  parentId?: string | undefined;
}): boolean {
  return comment.quote !== undefined && comment.parentId === undefined;
}
