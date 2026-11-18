import { expect, test } from '@playwright/test';
import path from 'node:path';
import { openPage as openSheetPage } from './sheet-pages';

const shots = path.resolve(import.meta.dirname, 'screenshots');

// Runs after phase0.spec.ts in the same database, so the DM account already exists.
test('character sheet: formulas, counters, modules and search', async ({ browser }) => {
  const context = await browser.newContext();
  const dm = await context.newPage();
  await dm.goto('/');
  await dm.getByLabel('Login name').fill('dm');
  await dm.getByLabel('Password').fill('dm-password');
  await dm.getByRole('button', { name: 'Log in' }).click();

  // The rules table that sheets read the proficiency bonus from: +2 from level 1, +3 from level 5.
  await dm.getByRole('link', { name: 'Rules' }).click();
  await dm.getByPlaceholder('New rule…').fill('Proficiency Bonus from Level');
  await dm.getByRole('button', { name: 'Add', exact: true }).click();
  const formulaName = dm.locator('div.match-target', { hasText: 'Formula name' }).locator('input');
  await formulaName.fill('proficiency_bonus');
  await formulaName.blur();
  await dm.getByRole('button', { name: 'Add a table' }).click();
  const cell = async (label: string, value: string) => {
    await dm.getByLabel(label, { exact: true }).fill(value);
    await dm.getByLabel(label, { exact: true }).blur();
    await expect(dm.getByLabel(label, { exact: true })).toHaveValue(value);
  };
  await cell('Heading of column 1', 'Level');
  await cell('Heading of column 2', 'Proficiency Bonus');
  await cell('Row 1, column 1', '1');
  await cell('Row 1, column 2', '2');
  await dm.getByRole('button', { name: '+ Row' }).click();
  await cell('Row 2, column 1', '5');
  await cell('Row 2, column 2', '3');
  await dm.screenshot({ path: path.join(shots, 'rules-table-desktop.png'), fullPage: true });

  await dm.getByRole('link', { name: 'Characters' }).click();
  await dm.getByPlaceholder('New character…').fill('Elara Fairhold');
  await dm.getByRole('button', { name: 'Add' }).click();
  await expect(dm.getByLabel('Name', { exact: true })).toHaveValue('Elara Fairhold');
  // A new character opens on Basic Info, in Edit. Every other page opens for reading.
  await expect(dm).toHaveURL(/\/characters\/[^/]+\/basic$/);
  const openPage = (label: string, edit = true) => openSheetPage(dm, label, edit);
  await openPage('Stats');

  // A row of the sheet: its label, then its inputs.
  const rowOf = (label: string) => dm.locator('div.match-target', { hasText: label }).first();
  const type = async (row: string, field: string, value: string) => {
    const input = rowOf(row).getByLabel(field, { exact: true });
    await input.fill(value);
    await input.blur();
  };

  // Charisma 18 gives +4; with proficiency bonus 3 and proficiency, Persuasion is +7.
  await type('Charisma (CHA)', 'Value', '18');
  await expect(rowOf('Charisma (CHA)').locator('output')).toHaveText('+4');
  // Level 6 falls in the "from level 5" row of the rules table: +3.
  const level = dm.locator('div.match-target', { hasText: 'Level' }).first().locator('input');
  await level.fill('6');
  await level.blur();
  await expect(dm.locator('div.match-target', { hasText: 'Proficiency Bonus' }).locator('output')).toHaveText('+3');
  await expect(rowOf('Strength (STR)').locator('output')).toHaveText('+0');
  await openPage('Skills', false); // a tick box works while reading
  await rowOf('Persuasion (CHA)').getByLabel('Proficient').click();
  await expect(rowOf('Persuasion (CHA)').locator('output')).toHaveText('+7');
  await openPage('Stats', false);

  // Tick boxes: two points of inspiration out of four.
  const inspiration = dm.locator('div.match-target', { hasText: 'Inspiration' });
  await inspiration.getByRole('button', { name: '2 of 4' }).click();
  await expect(inspiration.getByRole('button', { name: '2 of 4' })).toHaveAttribute('aria-pressed', 'true');
  await expect(inspiration.getByRole('button', { name: '3 of 4' })).toHaveAttribute('aria-pressed', 'false');

  // The Spellcasting module adds its sections to this character only, on Spells Known.
  // Modules are chosen under "Sheet settings" at the bottom of Basic Info.
  await openPage('Spells Known', false);
  await expect(dm.getByText('Spell Slots')).toHaveCount(0);
  await openPage('Basic Info');
  await dm.locator('[data-sheet-settings]').getByLabel('Spellcasting', { exact: true }).click();
  await openPage('Spells Known');
  await expect(dm.getByRole('button', { name: /Spell Slots/ })).toBeVisible();
  await dm.locator('div.match-target', { hasText: 'Spellcasting ability' }).locator('select').selectOption('cha');
  await expect(rowOf('Spell Save DC').locator('output')).toHaveText('15'); // 8 + 3 + 4

  // Search: part of a word finds the row, opens its closed section and counts the matches.
  await openPage('Skills', false);
  await dm.getByRole('button', { name: /^. Skills$/ }).click(); // collapse Skills
  await expect(dm.getByText('Persuasion (CHA)')).toHaveCount(0);
  await dm.getByLabel('Search this character').fill('persu');
  await expect(dm.getByText('Persuasion (CHA)')).toBeVisible();
  await expect(dm.getByText('3 found', { exact: true })).toBeVisible(); // the three inputs of the Persuasion row
  // From another page the matches are counted in the menu, and the search stays on.
  await openPage('Stats', false);
  await expect(dm.getByText('Nothing on this page · 3 on other pages')).toBeVisible();
  await expect(dm.locator('[data-page="skills"]')).toContainText('3');
  await openPage('Skills', false);
  await expect(dm.getByLabel('Search this character')).toHaveValue('persu');
  await dm.screenshot({ path: path.join(shots, 'sheet-search-desktop.png') });
  await dm.getByLabel('Search this character').fill('');

  await dm.screenshot({ path: path.join(shots, 'sheet-desktop.png'), fullPage: true });
  await dm.setViewportSize({ width: 390, height: 800 });
  await dm.screenshot({ path: path.join(shots, 'sheet-phone.png'), fullPage: true });
});
