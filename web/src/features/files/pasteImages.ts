/**
 * Insert uploaded-image markdown at the caret of a textarea writing surface.
 */

import type { EditorState } from '~/editor/inputRules';
import { markdownImage, uploadImage, imageFilesFromDataTransfer } from '~/features/files/upload';
import type { UUID } from '~/store';

export function insertAtCaret(state: EditorState, snippet: string): EditorState {
  const before = state.text.slice(0, state.caret);
  const after = state.text.slice(state.caret);
  // Images are block-ish in the writing surface: a screenshot mid-sentence starts a new
  // line so the markdown stays readable. Plain text inserts (tests, future helpers) do not.
  const needsLead =
    snippet.startsWith('![') && before !== '' && !before.endsWith('\n') && !before.endsWith(' ');
  const lead = needsLead ? '\n' : '';
  const text = `${before}${lead}${snippet}${after}`;
  return { text, caret: before.length + lead.length + snippet.length };
}

/**
 * Upload every image in a paste/drop and return the next editor state, or null when there
 * were no images (so the browser's default paste of text still runs).
 */
export async function pasteImagesInto(
  state: EditorState,
  data: DataTransfer | null,
  options: { readonly issueId?: UUID | undefined } = {},
): Promise<EditorState | null> {
  const files = imageFilesFromDataTransfer(data);
  if (files.length === 0) return null;

  let next = state;
  for (let i = 0; i < files.length; i += 1) {
    const file = files[i]!;
    const uploaded = await uploadImage(file, options.issueId);
    next = insertAtCaret(next, markdownImage(uploaded.name, uploaded.url));
    if (i < files.length - 1) {
      next = insertAtCaret(next, '\n');
    }
  }
  return next;
}
