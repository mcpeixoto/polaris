/**
 * Search, in a real browser.
 *
 * One thing about this screen cannot be asserted anywhere below the browser, and it is the
 * reason this file exists: whether the box keeps what was typed into it.
 *
 * The query lives in `?q=`, and react-router applies a location change inside
 * `React.startTransition`. A transition is interruptible; the thing that interrupts it is
 * the next keystroke. React then re-renders urgently with the previous location, finds a
 * controlled input whose `value` prop disagrees with the DOM, and resets the DOM to the
 * prop — losing the character that arrived while the transition was pending, from the box
 * and from the URL both. jsdom cannot show this: `userEvent` flushes React between
 * keystrokes, so every transition has already committed before the next key is pressed and
 * the window in which characters are lost never opens.
 *
 * The CPU throttle is what makes it a test rather than a coin flip. On an unloaded
 * developer machine the window is a couple of milliseconds wide and only superhuman typing
 * falls into it; at 4x — an ordinary laptop, or a busy tab — it is wide enough that
 * eighty words a minute loses characters, which is the machine most people are actually
 * using. Before the fix, 6x turned "json parser bug" typed at 150ms a character into
 * "jnrr" — and at 4x it still lost one, which is the honest reason the rate here is the
 * higher of the two: the defect is the same, and this is the setting at which it shows
 * every time rather than most times.
 */

import { expect, signIn, test } from './fixtures';

const PHRASE = 'json parser bug';

test('the search box keeps every character typed into it', async ({ page, workspace }) => {
  await signIn(page, workspace.account);

  await page.goto('/search');
  const box = page.getByRole('searchbox', { name: 'Search' });
  await box.waitFor();
  await box.click();

  // Throttled only now that the screen is up, so the slowdown lands on the typing rather
  // than on the boot.
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 6 });

  // 150ms a character is about eighty words a minute — brisk, not exceptional.
  await page.keyboard.type(PHRASE, { delay: 150 });

  await expect(box).toHaveValue(PHRASE);
  // And the URL says the same thing, because a search has to be a link somebody can send.
  await expect(page).toHaveURL(/[?&]q=json\+parser\+bug/);

  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
});

test('a search survives being reloaded and being navigated back to', async ({
  page,
  workspace,
}) => {
  await signIn(page, workspace.account);
  await page.goto('/search');
  const box = page.getByRole('searchbox', { name: 'Search' });
  await box.waitFor();

  await box.fill('parser');
  await expect(page).toHaveURL(/[?&]q=parser/);

  await page.reload();
  await expect(box).toHaveValue('parser');

  // A query that arrives from outside the box — here, the address bar — reaches the box.
  await page.goto('/search?q=encoding');
  await expect(box).toHaveValue('encoding');
  await page.goBack();
  await expect(box).toHaveValue('parser');
});
