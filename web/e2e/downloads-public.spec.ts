import { expect, test } from '@playwright/test';

test('an iPhone QR visitor can get Polaris while desktop release lookup is unavailable', async ({
  browser,
}) => {
  const context = await browser.newContext({
    userAgent:
      'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1',
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  const page = await context.newPage();
  await page.route('https://api.github.com/repos/mcpeixoto/polaris/releases/latest', (route) =>
    route.fulfill({ status: 503, body: '{}' }),
  );
  await page.goto('/downloads');
  await expect(page.getByRole('heading', { name: 'Polaris for iOS' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Get it on the App Store →' })).toHaveAttribute(
    'href',
    'https://apps.apple.com/app/id6805606134',
  );
  await expect(page.getByRole('heading', { name: 'macOS', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.screenshot({
    path: '/tmp/polaris-download-mobile.png',
    fullPage: true,
    animations: 'disabled',
  });
  await context.close();
});

test('a desktop visitor can choose either Mac architecture and another platform', async ({
  page,
}) => {
  await page.route('https://api.github.com/repos/mcpeixoto/polaris/releases/latest', (route) =>
    route.fulfill({ status: 503, body: '{}' }),
  );
  await page.goto('/downloads');
  await expect(page.getByRole('heading', { name: 'macOS', exact: true })).toBeVisible();
  await expect(page.getByText('Apple Silicon', { exact: true })).toBeVisible();
  await expect(page.getByText('Intel', { exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Get the iPhone app ↗' })).toBeVisible();
  await page.screenshot({
    path: '/tmp/polaris-download-desktop.png',
    fullPage: true,
    animations: 'disabled',
  });
});

test('a successful release supplies every real installer choice', async ({ page }) => {
  const names = [
    'Polaris-0.34.0-mac-arm64.dmg',
    'Polaris-0.34.0-mac-x64.dmg',
    'Polaris-Setup-0.34.0.exe',
    'Polaris-0.34.0-linux-x86_64.AppImage',
    'polaris_0.34.0_amd64.deb',
  ];
  await page.route('https://api.github.com/repos/mcpeixoto/polaris/releases/latest', (route) =>
    route.fulfill({
      json: {
        tag_name: 'v0.34.0',
        draft: false,
        prerelease: false,
        assets: names.map((name) => ({
          name,
          size: 100,
          state: 'uploaded',
          browser_download_url: `https://github.com/mcpeixoto/polaris/releases/download/v0.34.0/${name}`,
        })),
      },
    }),
  );
  await page.goto('/downloads');
  await expect(page.getByText('Latest release · 0.34.0')).toBeVisible();
  await expect(page.getByRole('link', { name: /Download / })).toHaveCount(5);
  await page.screenshot({
    path: '/tmp/polaris-download-desktop-success.png',
    fullPage: true,
    animations: 'disabled',
  });
});
