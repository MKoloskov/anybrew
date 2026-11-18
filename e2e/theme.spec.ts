import { expect, test } from '@playwright/test';
import path from 'node:path';
import { openPage } from './sheet-pages';

const shots = path.resolve(import.meta.dirname, 'screenshots');

// Runs after phase0.spec.ts in the same database, so the DM account already exists.
test('light / dark switch: the choice is kept on this device and survives a reload', async ({ browser }) => {
  // The device itself is set to light.
  const context = await browser.newContext({ colorScheme: 'light' });
  const page = await context.newPage();
  const html = page.locator('html');
  const bodyBackground = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor);

  await page.goto('/');
  await page.getByLabel('Login name').fill('dm');
  await page.getByLabel('Password').fill('dm-password');
  await page.getByRole('button', { name: 'Log in' }).click();

  // Default: System, following the light device.
  const mode = page.getByLabel('Light or dark mode');
  await expect(mode).toHaveValue('system');
  await expect(html).toHaveAttribute('data-theme', 'light');
  const lightBackground = await bodyBackground();

  // Dark is applied at once and changes the colours.
  await mode.selectOption('dark');
  await expect(html).toHaveAttribute('data-theme', 'dark');
  expect(await bodyBackground()).not.toBe(lightBackground);

  // After a reload the page is dark from the first paint, before the app has loaded.
  await page.reload({ waitUntil: 'commit' });
  await page.waitForSelector('html[data-theme]', { state: 'attached' });
  await expect(html).toHaveAttribute('data-theme', 'dark');
  await expect(mode).toHaveValue('dark');

  // System follows the device, also when the device setting changes.
  await mode.selectOption('system');
  await expect(html).toHaveAttribute('data-theme', 'light');
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(html).toHaveAttribute('data-theme', 'dark');

  // Light overrides a dark device.
  await mode.selectOption('light');
  await expect(html).toHaveAttribute('data-theme', 'light');
  await page.reload();
  await expect(mode).toHaveValue('light');
  await expect(html).toHaveAttribute('data-theme', 'light');
  expect(await bodyBackground()).toBe(lightBackground);

  // The choice belongs to this device only: another browser starts on System.
  const other = await browser.newContext({ colorScheme: 'dark' });
  const otherPage = await other.newPage();
  await otherPage.goto('/');
  await expect(otherPage.locator('html')).toHaveAttribute('data-theme', 'dark');
  await other.close();
  await context.close();
});

// Runs after sheet.spec.ts, so a character with a filled sheet exists.
test('Slate & Brass: fonts from our own server, dark top bar in both modes, brass active tab', async ({ browser }) => {
  for (const mode of ['light', 'dark'] as const) {
    for (const viewport of [
      { name: 'pc', width: 1280, height: 900 },
      { name: 'phone', width: 390, height: 800 },
    ]) {
      const context = await browser.newContext({ colorScheme: mode, viewport });
      const page = await context.newPage();
      const fontRequests: string[] = [];
      page.on('request', (r) => {
        if (r.resourceType() === 'font') fontRequests.push(r.url());
      });

      await page.goto('/');
      await page.getByLabel('Login name').fill('dm');
      await page.getByLabel('Password').fill('dm-password');
      await page.getByRole('button', { name: 'Log in' }).click();
      await page.getByRole('link', { name: 'Characters' }).click();

      // The top bar is dark slate in both modes; the active tab is marked by brass, not a filled button.
      const bar = await page.locator('header.bar').evaluate((el) => getComputedStyle(el).backgroundColor);
      expect(bar).toBe(mode === 'light' ? 'rgb(31, 36, 48)' : 'rgb(15, 17, 22)');
      const active = page.locator('header.bar a[aria-current="page"]');
      await expect(active).toHaveText('Characters');
      const underline = await active.evaluate((el) => getComputedStyle(el).borderBottomColor);
      expect(underline).toBe(mode === 'light' ? 'rgb(150, 104, 31)' : 'rgb(212, 166, 86)');

      // A character sheet, for the fonts of names and headings.
      await page.locator('li[data-entity] a').first().click();
      await expect(page.locator('[data-entity-name]')).toBeVisible();
      await page.evaluate(() => document.fonts.ready);

      // Text in Source Sans 3, names and headings in Marcellus SC; all fonts come from this server.
      expect(await page.evaluate(() => document.fonts.check('16px "Source Sans 3 Variable"'))).toBe(true);
      expect(await page.evaluate(() => document.fonts.check('16px "Marcellus SC"'))).toBe(true);
      expect(fontRequests.length).toBeGreaterThan(0);
      for (const url of fontRequests) expect(new URL(url).host).toBe(new URL(page.url()).host);

      await page.screenshot({ path: path.join(shots, `v2-sheet-${mode}-${viewport.name}.png`), fullPage: viewport.name === 'pc' });
      await context.close();
    }
  }
});

test('Slate & Brass: Russian letters in headings use Spectral SC', async ({ browser }) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto('/');
  await page.getByLabel('Login name').fill('dm');
  await page.getByLabel('Password').fill('dm-password');
  await page.getByRole('button', { name: 'Log in' }).click();
  await page.getByLabel('Reading language').selectOption('ru');
  await page.getByRole('link', { name: 'Characters' }).click();
  await page.locator('li[data-entity] a').first().click();
  // The ability rows show every label in Edit, also where nothing is filled in.
  await openPage(page, 'Stats', true);
  await expect(page.getByText('Сила').first()).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  expect(await page.evaluate(() => document.fonts.check('500 16px "Spectral SC"', 'Сила'))).toBe(true);
  await page.screenshot({ path: path.join(shots, 'v2-sheet-russian.png'), fullPage: true });
  await page.getByLabel('Reading language').selectOption('en');
  await context.close();
});
