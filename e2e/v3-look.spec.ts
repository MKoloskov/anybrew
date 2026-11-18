import { expect, test } from '@playwright/test';
import path from 'node:path';

const shots = path.resolve(import.meta.dirname, 'screenshots');

// Runs after phase0.spec.ts in the same database, so the DM account and characters exist.
// V3 (PLAN.md section 11.5): section icons on the tabs, the d20 logo and empty lists, the stone login page.

test('login page: stone texture in both modes, brass-framed card with the d20 logo', async ({ browser }) => {
  for (const mode of ['light', 'dark'] as const) {
    for (const viewport of [
      { name: 'pc', width: 1280, height: 900 },
      { name: 'phone', width: 390, height: 800 },
    ]) {
      const context = await browser.newContext({ colorScheme: mode, viewport });
      const page = await context.newPage();
      await page.goto('/');
      await expect(page.getByRole('heading', { name: 'Log in' })).toBeVisible();

      // The background is the dark stone in both modes.
      const stone = page.locator('[data-login-page]');
      const bg = await stone.evaluate((el) => getComputedStyle(el).backgroundImage);
      expect(bg).toContain('data:image/svg+xml');
      expect(bg).toContain('radial-gradient');

      // The card carries the logo and a brass edge.
      const card = page.locator('.login-card');
      await expect(card.getByText('AnyBrew')).toBeVisible();
      await expect(card.locator('svg')).toBeVisible();
      const edge = await card.evaluate((el) => getComputedStyle(el).borderTopColor);
      expect(edge).toBe(mode === 'light' ? 'rgb(150, 104, 31)' : 'rgb(212, 166, 86)');

      await page.screenshot({ path: path.join(shots, `v3-login-${mode}-${viewport.name}.png`) });
      await context.close();
    }
  }
});

test('tabs have icons; on a phone the labels drop and the icons stay; the d20 marks the logo and empty lists', async ({ browser }) => {
  const tabs = ['Characters', 'Features', 'Spells', 'Items', 'Rules', 'Glossary', 'Notes', 'People', 'Data'];
  for (const viewport of [
    { name: 'pc', width: 1280, height: 900 },
    { name: 'phone', width: 390, height: 800 },
  ]) {
    const context = await browser.newContext({ viewport });
    const page = await context.newPage();
    await page.goto('/');
    await page.getByLabel('Login name').fill('dm');
    await page.getByLabel('Password').fill('dm-password');
    await page.getByRole('button', { name: 'Log in' }).click();
    await expect(page.locator('header.bar')).toBeVisible();

    // The d20 sits beside the System name.
    await expect(page.locator('header.bar svg').first()).toBeVisible();

    for (const label of tabs) {
      // The link keeps its name on every screen, so it can be found and read aloud; the tooltip names it too.
      const link = page.locator('header.bar nav').getByRole('link', { name: label, exact: true });
      await expect(link).toBeVisible();
      await expect(link).toHaveAttribute('title', label);
      await expect(link.locator('svg')).toBeVisible();
      const text = link.locator('span', { hasText: label });
      if (viewport.name === 'pc') await expect(text).toBeVisible();
      else expect((await text.boundingBox())?.width ?? 0).toBeLessThanOrEqual(1);
    }
    // On a phone the nine icons fit on one line.
    if (viewport.name === 'phone') {
      const tops = await page.locator('header.bar nav a').evaluateAll((els) => els.map((el) => Math.round(el.getBoundingClientRect().top)));
      expect(new Set(tops).size).toBe(1);
    }

    // An empty list shows the d20 above its message.
    await page.locator('header.bar nav').getByRole('link', { name: 'Characters', exact: true }).click();
    await page.getByLabel('Search characters').fill('zzzz no such name');
    const empty = page.locator('[data-empty]');
    // "No characters yet." when this file runs alone, without the characters made by earlier test files.
    await expect(empty).toContainText(/Nothing matches\.|No characters yet\./);
    await expect(empty.locator('svg')).toBeVisible();

    await page.screenshot({ path: path.join(shots, `v3-tabs-${viewport.name}.png`) });
    await context.close();
  }
});
