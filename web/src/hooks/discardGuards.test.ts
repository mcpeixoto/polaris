import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * Every dialog that holds typing asks before throwing it away.
 *
 * `useDiscardGuard` existed, documented, and two dialogs used it. The rest closed on Escape
 * unconditionally — and Escape is the fastest key on the keyboard, sitting next to the one
 * people press to shut a picker. A create dialog is the only place the words in it exist:
 * there is nothing to undo, because nothing was ever written.
 *
 * Source text rather than rendering, in the style of `views/screens.test.ts`: rendering every
 * dialog to press Escape at it would need a fixture per dialog, and those fixtures already
 * exist as the `*.discard.test.tsx` files beside each one. This asserts the cheaper, broader
 * thing — that none was forgotten.
 */

const SRC = join(__dirname, '..');

/**
 * What counts as holding typing: a `Modal` with a field somebody types into.
 *
 * A dialog of toggles and pickers is not in scope. Re-ticking a box is one click; retyping a
 * paragraph is not, which is the distinction `useDiscardGuard`'s docstring draws.
 */
const TEXT_FIELDS = ['<Input', '<Textarea', '<TitleField', '<WritingField'];

/**
 * Dialogs that hold typing and deliberately do not use the shared guard.
 *
 * Listed by hand, with the reason, because "this one is different" is a claim somebody has to
 * make on purpose — an empty allowance here is how the next silently-discarding dialog
 * becomes an exemption nobody argued for.
 */
const ANSWERS_IT_DIFFERENTLY: Record<string, string> = {
  'features/issue/CreateIssueModal.tsx':
    'offers to save a draft instead of discarding, because it is the one composer with ' +
    "somewhere to put one — named as the exception in useDiscardGuard's own docstring",
  'features/admin/InviteDialog.tsx':
    'its second state holds an invitation link that exists nowhere else, and its onClose ' +
    'already refuses incidental dismissals rather than asking about them',
  'views/Gallery.tsx': 'the dev-only component gallery, where the dialogs are specimens',
};

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    if (!entry.name.endsWith('.tsx') || entry.name.includes('.test.')) return [];
    return [path];
  });
}

function dialogsHoldingTyping(): string[] {
  return ['features', 'views', 'components']
    .flatMap((area) => sourceFiles(join(SRC, area)))
    .filter((path) => {
      const source = readFileSync(path, 'utf8');
      return source.includes('<Modal') && TEXT_FIELDS.some((field) => source.includes(field));
    })
    .map((path) => path.slice(SRC.length + 1))
    .sort();
}

describe('dialogs that hold typing', () => {
  const dialogs = dialogsHoldingTyping();

  it('finds the dialogs to check', () => {
    expect(
      dialogs.length,
      'no file renders a Modal with a text field in it, so this test is asserting nothing — ' +
        'the dialogs have changed shape and this needs to learn the new one',
    ).toBeGreaterThan(8);
  });

  it.each(dialogs)('%s asks before discarding it', (file) => {
    const excuse = ANSWERS_IT_DIFFERENTLY[file];
    if (excuse !== undefined) return;

    expect(
      readFileSync(join(SRC, file), 'utf8').includes('useDiscardGuard'),
      `${file} opens a dialog with something to type in and closes without asking. Escape ` +
        `sits beside the key that shuts a picker, and what was typed exists nowhere else — ` +
        `there is nothing to undo, because nothing was written. Use useDiscardGuard: give ` +
        `it a \`dirty\` that counts only what somebody changed from the defaults the dialog ` +
        `opened with, pass requestClose to Modal's onClose and to Cancel, and render ` +
        `ConfirmDialog while confirming. If this dialog answers the question some other ` +
        `way, add it to ANSWERS_IT_DIFFERENTLY with the reason.`,
    ).toBe(true);
  });

  it('keeps the allowance honest, so a dialog that adopts the guard leaves the list', () => {
    const stale = Object.keys(ANSWERS_IT_DIFFERENTLY).filter((file) => {
      try {
        return readFileSync(join(SRC, file), 'utf8').includes('useDiscardGuard');
      } catch {
        return true;
      }
    });

    expect(stale, 'these now use the shared guard and should leave the list').toEqual([]);
  });
});
