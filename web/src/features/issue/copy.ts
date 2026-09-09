/**
 * Copying an issue's name in the two shapes people paste it into.
 *
 * "Copy title as link" is the one that needs a module: a markdown link is what a person
 * wants in a pull request or a comment box, and rich text is what they want in a document —
 * and those are two clipboard flavours of one act rather than two commands. Everything else
 * a menu copies is a string and goes straight to `copyText`.
 */

/** The two flavours one copy puts on the clipboard. */
export interface RichText {
  readonly text: string;
  readonly html: string;
}

/**
 * `[ENG-12 Ship the importer](https://…/issue/ENG-12)`, and the same thing as an anchor.
 *
 * The identifier leads the label because that is how the product writes an issue everywhere
 * else — the row, the breadcrumb, the peek header — and because a pasted link that says only
 * the title loses the one word people search for afterwards.
 */
export function titleAsLink(identifier: string, title: string, url: string): RichText {
  return {
    text: `[${identifier} ${title}](${url})`,
    html: `<a href="${escapeHtml(url)}">${escapeHtml(`${identifier} ${title}`)}</a>`,
  };
}

/**
 * Puts both flavours on the clipboard, falling back to the plain one.
 *
 * `ClipboardItem` is missing in jsdom and in older Safari, and `write` is refused outright
 * where the document is not focused. Neither is worth a failed copy: the markdown text is
 * the flavour the person asked for, and a paste into a rich editor that renders it as
 * markdown is a good outcome rather than an error.
 */
export async function copyRich(value: RichText): Promise<boolean> {
  const clipboard: Clipboard | undefined = navigator.clipboard;
  if (clipboard === undefined) return false;
  const Item = globalThis.ClipboardItem as typeof ClipboardItem | undefined;
  if (Item !== undefined && typeof clipboard.write === 'function') {
    try {
      await clipboard.write([
        new Item({
          'text/plain': new Blob([value.text], { type: 'text/plain' }),
          'text/html': new Blob([value.html], { type: 'text/html' }),
        }),
      ]);
      return true;
    } catch {
      // Falls through to the plain write below rather than reporting: a clipboard that
      // refuses the rich flavour usually still takes the text one.
    }
  }
  try {
    await clipboard.writeText(value.text);
    return true;
  } catch {
    return false;
  }
}

/** The five characters that would otherwise end an attribute or open a tag. */
function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}
