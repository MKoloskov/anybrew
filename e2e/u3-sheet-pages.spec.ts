import { expect, test, type Page } from '@playwright/test';
import path from 'node:path';
import { openPage } from './sheet-pages';

const shots = path.resolve(import.meta.dirname, 'screenshots');
// Two tiny different pictures for the gallery.
const RED = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFElEQVR4nGP8z8Dwn4GBgYGJAQoAHxcCAr7pnmkAAAAASUVORK5CYII=', 'base64');
const BLUE = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGNgYPgPAAEDAQAIicLsAAAAAElFTkSuQmCC', 'base64');

// Runs after u2-character-list.spec.ts in the same database: Mira owns Ilyra Moonwhisper (Heart of Anauroch),
// Elara is another player of that campaign, Brann plays another campaign.
// U3 (PLAN.md section 10.1, decisions 13 to 16 in 10.7): the focused sheet with its pages, the header
// above every page, Home and Preview, and the portrait gallery.

async function login(page: Page, name: string, password: string) {
  await page.goto('/');
  await page.getByLabel('Login name').fill(name);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Log in' }).click();
  await expect(page.locator('header.bar')).toBeVisible();
}

const ALL_PAGES = [
  'Home',
  'Preview',
  'Basic Info',
  'Stats',
  'Skills',
  'Class Abilities',
  'Subclass Abilities',
  'Hero Abilities',
  'Inventory',
  'Spells Known',
  'Progression History',
  'Open Character History',
  'Character Secrets',
  'DM Secrets',
  'Char Notes',
  'Combat',
];

test('focused sheet: page menu, an address per page, Read on every page, pages per viewer', async ({ browser }) => {
  // ---- The DM opens Ilyra from the list: Home, full focus, all 16 pages ----
  const dmContext = await browser.newContext();
  const dm = await dmContext.newPage();
  await login(dm, 'dm', 'dm-password');
  await dm.getByRole('link', { name: 'Characters', exact: true }).click();
  await dm.locator('li[data-entity="Ilyra Moonwhisper"] a').click();
  await expect(dm).toHaveURL(/\/characters\/[^/]+\/home$/);
  const sheetUrl = dm.url().replace(/\/home$/, '');

  // The site navigation gives way to one way back.
  const bar = dm.locator('header.bar');
  await expect(bar.getByRole('link', { name: '← Characters' })).toBeVisible();
  await expect(bar.getByRole('link', { name: 'Features', exact: true })).toHaveCount(0);
  await expect(bar.getByRole('link', { name: 'People', exact: true })).toHaveCount(0);

  const menu = dm.getByRole('navigation', { name: 'Pages of the sheet' });
  await expect(menu.getByRole('link')).toHaveText(ALL_PAGES);
  await expect(menu.getByRole('link', { name: 'Home', exact: true })).toHaveAttribute('aria-current', 'page');
  await expect(dm.locator('[data-editor]')).toHaveAttribute('data-editor', 'read');
  // The header carries the name, and the first letter while there is no portrait.
  await expect(dm.locator('[data-sheet-header] [data-entity-name]')).toHaveText('Ilyra Moonwhisper');
  await expect(dm.locator('[data-sheet-header] [data-portrait]')).toHaveText('I');

  // ---- Edit on one page does not carry over to the next ----
  await openPage(dm, 'Stats', true);
  await expect(dm).toHaveURL(`${sheetUrl}/stats`);
  await openPage(dm, 'Skills');
  await expect(dm.locator('[data-editor]')).toHaveAttribute('data-editor', 'read');

  // ---- An address per page: reload and Back land on the same page ----
  await dm.reload();
  await expect(dm.locator('[data-sheet-page]')).toHaveAttribute('data-sheet-page', 'skills');
  await expect(dm.getByText('Persuasion (CHA)')).toBeVisible();
  await dm.goBack();
  await expect(dm.locator('[data-sheet-page]')).toHaveAttribute('data-sheet-page', 'stats');
  // An unknown page falls back to Home.
  await dm.goto(`${sheetUrl}/nowhere`);
  await expect(dm).toHaveURL(`${sheetUrl}/home`);

  // ---- Combat shows AC and HP, which are stored once in Secondary Stats ----
  await openPage(dm, 'Combat', true);
  const shown = dm.locator('[data-shows="combat"]');
  const ac = shown.locator('.sheet-row', { hasText: 'Armor Class (AC)' }).getByLabel('Total');
  await ac.fill('15');
  await ac.blur();
  await expect(dm.getByRole('button', { name: /Death Saves/ })).toBeVisible();
  await openPage(dm, 'Stats', true);
  await expect(dm.locator('.sheet-row', { hasText: 'Armor Class (AC)' }).getByLabel('Total')).toHaveValue('15');

  // ---- The gallery: several pictures at once, the first one main, a large view, another made main ----
  await openPage(dm, 'Basic Info', true);
  const gallery = dm.locator('[data-gallery]');
  await gallery.locator('input[type=file]').setInputFiles([
    { name: 'red.png', mimeType: 'image/png', buffer: RED },
    { name: 'blue.png', mimeType: 'image/png', buffer: BLUE },
  ]);
  await expect(gallery.locator('[data-picture]')).toHaveCount(2);
  await expect(gallery.getByText('2 of 30')).toBeVisible();
  await expect(gallery.locator('[data-picture="1"]')).toHaveAttribute('data-main', '');
  const src = (img: ReturnType<Page['locator']>) => img.getAttribute('src');
  const first = await src(gallery.locator('[data-picture="1"] img'));
  const second = await src(gallery.locator('[data-picture="2"] img'));
  // The header above every page shows the main picture in its frame.
  const headerPortrait = dm.locator('[data-sheet-header] [data-portrait] img');
  await expect(headerPortrait).toHaveAttribute('src', first!);
  await gallery.getByRole('button', { name: 'Open picture 1 (main)' }).click();
  const viewer = dm.getByRole('dialog');
  await expect(viewer).toHaveAccessibleName('Picture 1 of 2');
  await dm.keyboard.press('ArrowRight');
  await expect(viewer).toHaveAccessibleName('Picture 2 of 2');
  await dm.screenshot({ path: path.join(shots, 'u3-gallery-viewer.png') });
  await viewer.getByRole('button', { name: 'Make main' }).click();
  await expect(headerPortrait).toHaveAttribute('src', second!);
  await dm.keyboard.press('Escape');
  await expect(viewer).toHaveCount(0);
  await expect(gallery.locator('[data-picture="2"]')).toHaveAttribute('data-main', '');
  await expect(dm.locator('[data-d20-divider]')).toBeVisible();
  await dm.screenshot({ path: path.join(shots, 'u3-gallery.png'), fullPage: true });

  // ---- Sheet settings are at the bottom of Basic Info and nowhere else ----
  await openPage(dm, 'Stats', true);
  await expect(dm.locator('[data-sheet-settings]')).toHaveCount(0);
  await openPage(dm, 'Basic Info', true);
  const settings = dm.locator('[data-sheet-settings]');
  await expect(settings.getByText('Who can see the sheet:')).toBeVisible();
  await expect(settings.getByText('Sheet modules:')).toBeVisible();
  await expect(settings.getByRole('button', { name: 'Delete' })).toBeVisible();
  await dm.screenshot({ path: path.join(shots, 'u3-basic-info-dm.png'), fullPage: true });

  // ---- Home: class and level, AC, HP, the six abilities and the tags, all from other pages ----
  await openPage(dm, 'Home');
  const home = dm.locator('[data-home]');
  await expect(home.locator('[data-tile="ac"]')).toContainText('15');
  await expect(home.locator('[data-tile="hp"]')).toContainText('– / –');
  await expect(home.locator('[data-ability]')).toHaveCount(6);
  await expect(home.locator('[data-ability="str"]')).toContainText('+0');
  await expect(home.locator('[data-home-tag="Cormyr"]')).toBeVisible();
  await dm.screenshot({ path: path.join(shots, 'u3-home-dm.png'), fullPage: true });

  // ---- The search counts matches on every page ----
  await dm.getByLabel('Search this character').fill('persu');
  await expect(menu.locator('[data-page="skills"]')).toContainText('3');
  await expect(dm.getByText('Nothing on this page · 3 on other pages')).toBeVisible();
  await dm.screenshot({ path: path.join(shots, 'u3-search-counts.png') });

  // ---- Mira, the owner, on a phone: a drop-down instead of the menu, no DM Secrets ----
  const miraContext = await browser.newContext({ viewport: { width: 390, height: 800 } });
  const mira = await miraContext.newPage();
  await login(mira, 'mira', 'mira-password');
  await mira.goto(sheetUrl);
  await expect(mira).toHaveURL(`${sheetUrl}/home`);
  await expect(mira.getByRole('navigation', { name: 'Pages of the sheet' })).toBeHidden();
  const dropDown = mira.getByLabel('Page of the sheet');
  await expect(dropDown).toBeVisible();
  const options = await dropDown.locator('option').allTextContents();
  expect(options).toEqual(ALL_PAGES.filter((p) => p !== 'DM Secrets'));
  await dropDown.selectOption({ label: 'Skills' });
  await expect(mira).toHaveURL(`${sheetUrl}/skills`);
  await expect(mira.getByText('Persuasion (CHA)')).toBeVisible();
  await mira.goto(`${sheetUrl}/dm`); // a page she does not have
  await expect(mira).toHaveURL(`${sheetUrl}/home`);
  await mira.screenshot({ path: path.join(shots, 'u3-sheet-owner-phone.png'), fullPage: true });

  // ---- Elara, another player of the campaign: the Preview only ----
  const elaraContext = await browser.newContext();
  const elara = await elaraContext.newPage();
  await login(elara, 'elara', 'elara-password');
  await elara.goto(sheetUrl);
  await expect(elara).toHaveURL(`${sheetUrl}/preview`);
  await expect(elara.getByRole('navigation', { name: 'Pages of the sheet' }).getByRole('link')).toHaveText(['Preview']);
  await expect(elara.locator('[data-shows="preview"]')).toContainText('Harpers');
  await expect(elara.locator('[data-shows="preview"]')).toContainText('Moon elf');
  // The main picture, large; the rest of the gallery is not served to her.
  await expect(elara.locator('[data-shows="preview"] [data-portrait] img')).toHaveAttribute('src', second!);
  expect((await elara.request.get(second!)).status()).toBe(200);
  expect((await elara.request.get(first!)).status()).not.toBe(200);
  await elara.goto(`${sheetUrl}/stats`);
  await expect(elara).toHaveURL(`${sheetUrl}/preview`);
  await expect(elara.getByText('Armor Class (AC)')).toHaveCount(0);
  await expect(elara.getByRole('button', { name: 'Edit', exact: true })).toHaveCount(0);
  await elara.screenshot({ path: path.join(shots, 'u3-sheet-other-player.png'), fullPage: true });

  // ---- "← Characters" leads back to the list with the site navigation ----
  await bar.getByRole('link', { name: '← Characters' }).click();
  await expect(dm.locator('[data-character-list]')).toBeVisible();
  await expect(bar.getByRole('link', { name: 'Features', exact: true })).toBeVisible();

  for (const c of [dmContext, miraContext, elaraContext]) await c.close();
});
