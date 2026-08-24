/**
 * ⌘Z in the places people write more than a word.
 *
 * This is a browser test because the thing under test is the browser. Nothing in the app's
 * code implements undo — the textarea's own edit history does — and what broke it was a
 * write React makes to `node.defaultValue` on every commit of a controlled `<textarea>`.
 * Rewriting a textarea's text content while somebody is typing in it ends the typing command
 * the engine was coalescing keystrokes into, so each character became its own undo entry and
 * ⌘Z walked backwards one letter at a time through a paragraph. There is no unit-level
 * assertion for that: jsdom has no edit history, and the only honest question is what a real
 * engine does after a real burst of typing.
 *
 * So each case types a burst, presses undo *once*, and expects the whole burst to be gone —
 * then redoes it, because a fix that trades one direction for the other is not a fix. All
 * three surfaces are here rather than one because they are three different shapes over the
 * same primitive: the shared `Textarea` (document body, comment composer) and the description
 * editor's own textarea, which sits over a mark overlay and cannot use it.
 */

import { createIssueViaApi, expect, signIn, test } from './fixtures';

const BURST = 'the whole of this sentence should vanish at once';

/** Comfortably more lines than the document body's sixteen-line resting height. */
const LINES = Array.from({ length: 24 }, (_, index) => `line ${index + 1}`).join('\n');

/**
 * Type, undo once, redo once.
 *
 * `pressSequentially` rather than `fill`, and with a delay: `fill` sets the value in one
 * shot, which produces a single undo entry no matter how broken the coalescing is, and would
 * pass against the very bug this exists to catch.
 */
async function burstUndoRedo(
  area: import('@playwright/test').Locator,
  page: import('@playwright/test').Page,
  seed: string,
) {
  await area.pressSequentially(BURST, { delay: 15 });
  await expect(area).toHaveValue(seed + BURST);

  await page.keyboard.press('ControlOrMeta+z');
  await expect(area).toHaveValue(seed);

  await page.keyboard.press('ControlOrMeta+Shift+z');
  await expect(area).toHaveValue(seed + BURST);
}

test.describe('native undo', () => {
  test('undoes a whole burst in an issue description', async ({ page, workspace }) => {
    const issue = await createIssueViaApi(workspace, 'Undo in a description');
    await signIn(page, workspace.account);
    await page.goto(`/issue/${issue.identifier}`);

    const area = page.getByLabel('Description');
    await area.waitFor();
    await area.click();
    await burstUndoRedo(area, page, '');
  });

  test('undoes a whole burst in a comment composer', async ({ page, workspace }) => {
    const issue = await createIssueViaApi(workspace, 'Undo in a comment');
    await signIn(page, workspace.account);
    await page.goto(`/issue/${issue.identifier}`);

    const area = page.getByPlaceholder(/leave a comment/i).first();
    await area.waitFor();
    await area.click();
    await burstUndoRedo(area, page, '');
  });

  test('undoes a whole burst in a document body', async ({ page, workspace }) => {
    await signIn(page, workspace.account);
    await page.goto(`/team/${workspace.teamKey}/documents`);

    await page.getByPlaceholder('New document…').fill('Undo runbook');
    await page.getByRole('button', { name: 'Create', exact: true }).click();

    const area = page.getByLabel('Body');
    await area.waitFor();
    await area.click();
    await burstUndoRedo(area, page, '');
  });

  /**
   * Undo has to survive the field having been filled from somewhere other than the keyboard,
   * because that is the ordinary case: a document that already has a body, an issue whose
   * description somebody else wrote. The text arrives through a ref rather than through a
   * `value` prop, and this asserts that the arrival is a clean slate to type on rather than
   * something the edit history is still entangled with.
   */
  test('undoes a burst typed after text arrived from the server', async ({ page, workspace }) => {
    await signIn(page, workspace.account);
    await page.goto(`/team/${workspace.teamKey}/documents`);

    await page.getByPlaceholder('New document…').fill('Undo over existing text');
    await page.getByRole('button', { name: 'Create', exact: true }).click();

    const area = page.getByLabel('Body');
    await area.waitFor();

    // Save a body, reload so it comes back from the replica rather than from this keyboard,
    // and only then type on top of it.
    await area.click();
    await area.pressSequentially('Existing paragraph.', { delay: 5 });
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByRole('button', { name: 'Save' })).toBeDisabled();

    await page.reload();
    const reloaded = page.getByLabel('Body');
    await expect(reloaded).toHaveValue('Existing paragraph.');

    await reloaded.click();
    // The caret lands where the click did; the burst has to go on the end of the existing
    // text, not into the middle of it.
    await page.keyboard.press('ControlOrMeta+End');
    await burstUndoRedo(reloaded, page, 'Existing paragraph.');
  });

  /**
   * The box measures itself and writes its own inline height, and the measurement now happens
   * after the text has been pushed into the element rather than after React set a `value`
   * prop. If those two ever swapped order the field would be sized against the text it was
   * showing a moment ago — a paragraph in a two-line box, with no error anywhere to say so.
   */
  test('keeps growing with what is typed, and with text that arrives whole', async ({
    page,
    workspace,
  }) => {
    await signIn(page, workspace.account);
    await page.goto(`/team/${workspace.teamKey}/documents`);

    await page.getByPlaceholder('New document…').fill('Growing body');
    await page.getByRole('button', { name: 'Create', exact: true }).click();

    const area = page.getByLabel('Body');
    await area.waitFor();
    const height = async () => (await area.boundingBox())?.height ?? 0;

    const atRest = await height();
    expect(atRest).toBeGreaterThan(0);

    // Past the sixteen lines the document body rests at, so growth is the only thing that
    // could account for the difference.
    await area.click();
    await area.pressSequentially(LINES, { delay: 2 });
    const typed = await height();
    expect(typed).toBeGreaterThan(atRest);

    // And after a reload, where the text arrives from the replica in one go rather than a
    // keystroke at a time — the path that goes through the ref rather than through `onInput`.
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByRole('button', { name: 'Save' })).toBeDisabled();
    await page.reload();

    const reloaded = page.getByLabel('Body');
    await expect(reloaded).toHaveValue(LINES);
    await expect
      .poll(async () => (await reloaded.boundingBox())?.height ?? 0)
      .toBeGreaterThanOrEqual(typed);
  });
});
