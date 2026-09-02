/**
 * Markdown input rules for the description textarea.
 *
 * The field is a plain textarea and stays one for now — the rich editor is a later slice —
 * so this is not a document model, it is the two keystrokes worth intercepting: the space
 * that finishes a block marker, and the Enter that continues or ends a list. Everything
 * else the writer types is left to the browser, which is what keeps native undo grouping
 * (see components/nativeValue.ts) intact for ordinary typing.
 *
 * Both rules are pure functions over `{ text, caret }` rather than key handlers, and that
 * is the reason they live in their own module: the interesting cases — a numbered list
 * renumbering, an empty item ending the list, a fence that is a closing fence — are
 * arithmetic on a string, and testing them through a DOM would test jsdom's textarea
 * instead.
 */

export interface EditorState {
  readonly text: string;
  readonly caret: number;
}

/**
 * Markers that are rewritten the moment their trailing space is typed.
 *
 * Only the ones that actually change anything are here. `#`, `##`, `-`, `1.` and `>` are
 * already the canonical spelling, so they are absent and the browser inserts the space
 * itself — a rule that replaces a string with itself would burn the undo entry for nothing.
 */
const SPACE_RULES: Readonly<Record<string, string>> = {
  '*': '- ',
  '+': '- ',
  '[]': '- [ ] ',
  '[x]': '- [x] ',
  ___: '---\n',
  '***': '---\n',
};

const BULLET = /^([ \t]*)([-*+]) (\[[ xX]\] )?(.*)$/;
const ORDERED = /^([ \t]*)(\d+)([.)]) (.*)$/;
const QUOTE = /^([ \t]*)> ?(.*)$/;
const FENCE = /^[ \t]*```[A-Za-z0-9+#-]*[ \t]*$/;

function lineStartOf(text: string, caret: number): number {
  return text.lastIndexOf('\n', caret - 1) + 1;
}

function lineEndOf(text: string, caret: number): number {
  const next = text.indexOf('\n', caret);
  return next === -1 ? text.length : next;
}

/**
 * The state after a space typed at `caret`, or null to let the browser insert it.
 *
 * Only fires when the whole of the line so far is the marker, so `2 * 3` and a `*` in the
 * middle of a sentence are ordinary characters.
 */
export function applySpaceRule(state: EditorState): EditorState | null {
  const { text, caret } = state;
  const start = lineStartOf(text, caret);
  const replacement = SPACE_RULES[text.slice(start, caret)];
  if (replacement === undefined) return null;
  return {
    text: text.slice(0, start) + replacement + text.slice(caret),
    caret: start + replacement.length,
  };
}

/**
 * The state after Enter at `caret`, or null to let the browser insert a newline.
 *
 * Continuation only applies with the caret at the end of its line. Enter in the middle of a
 * list item is a split, and prefixing the tail of a sentence with a bullet because the line
 * it came from had one is the kind of help nobody asked for.
 */
export function applyEnterRule(state: EditorState): EditorState | null {
  const { text, caret } = state;
  const start = lineStartOf(text, caret);
  if (caret !== lineEndOf(text, caret)) return null;
  const line = text.slice(start, caret);

  // An opening fence gets its closing one, so the writer types ``` once rather than
  // remembering to come back for it. A closing fence is just a line ending in a code block
  // and gets the plain newline — counting the fences above is the cheapest way to tell them
  // apart without parsing the document.
  if (FENCE.test(line)) {
    const opened = (text.slice(0, start).match(/^[ \t]*```/gm) ?? []).length % 2 === 0;
    if (!opened) return null;
    return { text: `${text.slice(0, caret)}\n\n\`\`\`${text.slice(caret)}`, caret: caret + 1 };
  }

  const ended = (): EditorState => ({
    text: text.slice(0, start) + text.slice(caret),
    caret: start,
  });

  const quote = QUOTE.exec(line);
  if (quote !== null) {
    const [, indent = '', content = ''] = quote;
    return content.trim() === '' ? ended() : insert(state, `\n${indent}> `);
  }

  const ordered = ORDERED.exec(line);
  if (ordered !== null) {
    const [, indent = '', number = '1', separator = '.', content = ''] = ordered;
    if (content.trim() === '') return ended();
    return insert(state, `\n${indent}${Number(number) + 1}${separator} `);
  }

  const bullet = BULLET.exec(line);
  if (bullet !== null) {
    const [, indent = '', marker = '-', check, content = ''] = bullet;
    if (content.trim() === '') return ended();
    // A checklist item continues as an *unticked* one: the next thing to do has not been
    // done yet, whatever the state of the line above it.
    return insert(state, `\n${indent}${marker} ${check === undefined ? '' : '[ ] '}`);
  }

  return null;
}

function insert(state: EditorState, snippet: string): EditorState {
  const { text, caret } = state;
  return {
    text: text.slice(0, caret) + snippet + text.slice(caret),
    caret: caret + snippet.length,
  };
}
