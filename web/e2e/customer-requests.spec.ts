/**
 * A request is a post, not an append-only log line.
 *
 * Feedback arrives half-quoted from a support thread and gets context added afterwards, so
 * the words have to stay editable where they are read — and a request attached to the wrong
 * issue has to be removable. Both mutations were wired end to end and neither had a caller,
 * so the only correction available to a person was a second request saying the same thing,
 * which then counted twice in the customer's demand roll-up and in every view filtering on
 * `customerCount`.
 *
 * Driven from both places a request is listed, because the two lists draw different rows
 * around the same entity and each has to show the other's edit.
 */

import { test, expect, signIn, createIssueViaApi } from './fixtures';

test('edit and remove a request from the issue and the customer page', async ({
  page,
  workspace,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  await signIn(page, workspace.account);

  await page.goto('/customers');
  await page.getByRole('button', { name: 'New customer' }).first().click();
  await page.getByLabel('Name').fill('Globex');
  await page.getByRole('button', { name: 'Create customer' }).click();
  await expect(page).toHaveURL(/\/customer\//);
  const customerUrl = page.url();

  const issue = await createIssueViaApi(workspace, 'Single sign-on');
  await page.goto(`/issue/${issue.identifier}`);
  const section = page.getByRole('region', { name: 'Customers' });
  await section.getByRole('button', { name: 'Add request' }).click();
  await page.getByRole('textbox', { name: 'Request' }).fill('SSO with Okta please.');
  await page.getByRole('combobox', { name: 'Customer' }).selectOption({ label: 'Globex' });
  await page.getByRole('dialog').getByRole('button', { name: 'Add request' }).click();
  await expect(section.getByText('SSO with Okta please.')).toHaveCount(1);

  // --- edit from the issue ---
  await section.getByRole('button', { name: /^Edit request from Globex$/ }).click();
  await page.getByLabel('Edit request').fill('SSO with Okta, and SCIM later.');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(section.getByText('SSO with Okta, and SCIM later.')).toHaveCount(1);
  await page.reload();
  await expect(section.getByText('SSO with Okta, and SCIM later.')).toHaveCount(1);
  await expect(section.getByText('SSO with Okta please.')).toHaveCount(0);

  // it is one post, not two
  await page.goto(customerUrl);
  await expect(page.getByText('SSO with Okta, and SCIM later.')).toHaveCount(1);

  // --- edit from the customer page ---
  await page
    .getByRole('button', { name: new RegExp(`^Edit request on ${issue.identifier}$`) })
    .click();
  await page.getByLabel('Edit request').fill('SSO, SCIM, and audit logs.');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByText('SSO, SCIM, and audit logs.')).toHaveCount(1);
  await page.reload();
  await expect(page.getByText('SSO, SCIM, and audit logs.')).toHaveCount(1);

  // roll-up still says one
  await page.goto('/customers');
  await expect(page.getByRole('link', { name: /Globex/ })).toContainText('1 request');

  // --- cancel leaves it alone ---
  await page.goto(customerUrl);
  await page
    .getByRole('button', { name: new RegExp(`^Edit request on ${issue.identifier}$`) })
    .click();
  await page.getByLabel('Edit request').fill('discarded');
  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByText('SSO, SCIM, and audit logs.')).toHaveCount(1);

  // --- remove from the customer page ---
  await page
    .getByRole('button', { name: new RegExp(`^Remove request on ${issue.identifier}$`) })
    .click();
  await page.getByRole('button', { name: 'Remove request', exact: true }).click();
  await expect(
    page.getByText('No requests yet. Capture feedback from this customer.'),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByText('No requests yet. Capture feedback from this customer.'),
  ).toBeVisible();

  await page.goto(`/issue/${issue.identifier}`);
  await expect(section.getByText('No customer requests on this issue.')).toBeVisible();

  await page.goto('/customers');
  await expect(page.getByRole('link', { name: /Globex/ })).toContainText('0 requests');

  // --- remove from the issue ---
  await page.goto(`/issue/${issue.identifier}`);
  await section.getByRole('button', { name: 'Add request' }).click();
  await page.getByRole('textbox', { name: 'Request' }).fill('Second thoughts.');
  await page.getByRole('combobox', { name: 'Customer' }).selectOption({ label: 'Globex' });
  await page.getByRole('dialog').getByRole('button', { name: 'Add request' }).click();
  await expect(section.getByText('Second thoughts.')).toHaveCount(1);
  await section.getByRole('button', { name: /^Remove request from Globex$/ }).click();
  await page.getByRole('button', { name: 'Remove request', exact: true }).click();
  await expect(section.getByText('No customer requests on this issue.')).toBeVisible();
  await page.reload();
  await expect(section.getByText('No customer requests on this issue.')).toBeVisible();

  expect(errors).toEqual([]);
});

test('the admin toggle takes the issue section with it', async ({ page, workspace }) => {
  await signIn(page, workspace.account);
  const issue = await createIssueViaApi(workspace, 'Still an issue');

  await page.goto('/customers');
  await page.getByRole('button', { name: 'New customer' }).first().click();
  await page.getByLabel('Name').fill('Globex');
  await page.getByRole('button', { name: 'Create customer' }).click();
  await expect(page).toHaveURL(/\/customer\//);

  await page.goto(`/issue/${issue.identifier}`);
  const section = page.getByRole('region', { name: 'Customers' });
  await section.getByRole('button', { name: 'Add request' }).click();
  await page.getByRole('textbox', { name: 'Request' }).fill('Made while on.');
  await page.getByRole('combobox', { name: 'Customer' }).selectOption({ label: 'Globex' });
  await page.getByRole('dialog').getByRole('button', { name: 'Add request' }).click();
  await expect(section.getByText('Made while on.')).toHaveCount(1);

  // Off: the section goes with the sidebar entry rather than offering a button the server
  // refuses once the words have been typed.
  await page.goto('/settings/customers');
  await page.getByLabel('Enable customer requests').uncheck();
  await page.goto(`/issue/${issue.identifier}`);
  await page.getByRole('heading', { name: 'Still an issue' }).waitFor();
  await expect(section).toHaveCount(0);
  await page.reload();
  await page.getByRole('heading', { name: 'Still an issue' }).waitFor();
  await expect(section).toHaveCount(0);

  // Back on: the request the toggle hid is still there.
  await page.goto('/settings/customers');
  await page.getByLabel('Enable customer requests').check();
  await page.goto(`/issue/${issue.identifier}`);
  await expect(section.getByText('Made while on.')).toHaveCount(1);
});
