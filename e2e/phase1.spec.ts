import { expect, test } from '@playwright/test';
import path from 'node:path';
import { openPage } from './sheet-pages';

const shots = path.resolve(import.meta.dirname, 'screenshots');

// A 2×2 red PNG.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFElEQVR4nGP8z8Dwn4GBgYGJAQoAHxcCAr7pnmkAAAAASUVORK5CYII=',
  'base64',
);

const NOTE = `**Talent Branches**

*Points Total: 60*

NINE HELLS

1) Seal of Darkness Tree (Nine Hells)
	1) Name: First Seal of Darkness (+) {4.5 PP}
		1) Type: Milestone Upgrade
		2) Prereq: -
		3) Description: Grants ability to cast CHA-based spells
	2) Name: Second Seal of Darkness {3.5 PP}
		1) Type: Major Upgrade
		2) Prereq: First Seal
	3) Name: Third Seal of Darkness {3.5 PP}
		1) Type: Major Upgrade
		2) Prereq: Second Seal
`;

// Runs after phase0.spec.ts in the same database, so the DM account already exists.
test('phase 1: Russian names and texts, glossary, custom fields, talent tree, picture', async ({ browser }) => {
  const context = await browser.newContext();
  const dm = await context.newPage();
  await dm.goto('/');
  await dm.getByLabel('Login name').fill('dm');
  await dm.getByLabel('Password').fill('dm-password');
  await dm.getByRole('button', { name: 'Log in' }).click();

  // ---- A glossary term with its Russian form ----
  await dm.getByRole('link', { name: 'Glossary' }).click();
  await dm.getByPlaceholder('New term…').fill('Perception');
  await dm.getByRole('button', { name: 'Add', exact: true }).click();
  await dm.getByLabel('Russian name').fill('Наблюдательность');
  await dm.getByLabel('Russian name').blur();
  const definition = dm.locator('div.match-target', { hasText: 'Definition' }).locator('textarea').first();
  await definition.fill('How well a character notices things.');
  await definition.blur();

  // ---- A character with a Russian name, a formatted description and its translation ----
  await dm.getByRole('link', { name: 'Characters' }).click();
  await dm.getByPlaceholder('New character…').fill('Esther Silverhand');
  await dm.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(dm.getByLabel('Name', { exact: true })).toHaveValue('Esther Silverhand');
  await dm.getByLabel('Russian name').fill('Эстер Силверхенд');
  await dm.getByLabel('Russian name').blur();

  // ---- A picture ----
  await dm.locator('input[type=file]').setInputFiles({ name: 'portrait.png', mimeType: 'image/png', buffer: PNG });
  const portrait = dm.getByRole('img', { name: 'Main picture' });
  await expect(portrait).toBeVisible();
  await expect.poll(() => portrait.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(2);

  // ---- A section that only this character has ----
  await dm.getByLabel('New section name').fill('Limited Abilities');
  await dm.getByRole('button', { name: 'Add section' }).click();
  await dm.getByLabel('New field name in Limited Abilities').fill('Bardic Inspiration');
  await dm.getByRole('button', { name: 'Add field' }).click();
  // The section itself is on Hero Abilities.
  await openPage(dm, 'Hero Abilities', true);
  await expect(dm.getByRole('button', { name: /^. Limited Abilities$/ })).toBeVisible();
  const bardic = dm.locator('div.match-target', { hasText: 'Bardic Inspiration' }).first();
  await bardic.getByLabel('Maximum').fill('3');
  await bardic.getByLabel('Maximum').blur();
  await bardic.getByRole('button', { name: '2 of 3' }).click();
  await expect(bardic.getByText('2 of')).toBeVisible();

  // ---- The description, on Open Character History ----
  await openPage(dm, 'Open Character History', true);
  const description = dm.getByRole('textbox', { name: 'Description', exact: true });
  await description.click();
  await dm.keyboard.type('A moon elf of ');
  await dm.getByRole('button', { name: 'B', exact: true }).first().click();
  await dm.keyboard.type('120 years');
  await dm.getByLabel('Search this character').click(); // leave the editor: this saves it
  const descriptionBox = dm.locator('div.match-target', { hasText: 'Add Russian translation' }).first();
  await expect(descriptionBox.locator('strong')).toHaveText('120 years');

  await descriptionBox.getByRole('button', { name: 'Add Russian translation' }).click();
  await dm.getByRole('textbox', { name: 'Russian translation of Description' }).click();
  await dm.keyboard.type('Лунная эльфийка');
  await dm.getByLabel('Search this character').click();
  await dm.getByRole('button', { name: 'Hide Russian translation' }).click();
  await expect(dm.getByRole('button', { name: 'Edit Russian translation' })).toBeVisible();

  // ---- The talent tree, loaded from the text of the note ----
  // The module is ticked under "Sheet settings" on Basic Info; the tree is on Class Abilities.
  await openPage(dm, 'Basic Info', true);
  await dm.locator('[data-sheet-settings]').getByLabel('Talent tree', { exact: true }).click();
  await openPage(dm, 'Class Abilities', true);
  await dm.getByRole('button', { name: 'Load from the note…' }).click();
  await dm.getByLabel('Talent note text').fill(NOTE);
  await dm.getByRole('button', { name: 'Load', exact: true }).click();
  await expect(dm.getByText('Loaded 1 trees with 3 talents, 1 of them taken.')).toBeVisible();
  await expect(dm.getByText('Spent 4.5 of 60 PP')).toBeVisible();
  const talent = (name: string) => dm.locator(`[data-talent="${name}"]`);
  await expect(talent('First Seal of Darkness')).toHaveAttribute('data-state', 'taken');
  await expect(talent('Second Seal of Darkness')).toHaveAttribute('data-state', 'available');
  await expect(talent('Third Seal of Darkness')).toHaveAttribute('data-state', 'locked');
  await dm.getByRole('button', { name: 'Take Second Seal of Darkness' }).click();
  await expect(dm.getByText('Spent 8 of 60 PP')).toBeVisible();
  await expect(talent('Third Seal of Darkness')).toHaveAttribute('data-state', 'available');
  await dm.screenshot({ path: path.join(shots, 'phase1-sheet-english.png'), fullPage: true });

  // ---- Reading in Russian ----
  await dm.getByLabel('Reading language').selectOption('ru');
  // The card on the list carries both names; the sheet then reads in Russian.
  await dm.getByRole('link', { name: '← Characters' }).click();
  await dm.getByRole('link', { name: /Esther Silverhand \(Эстер Силверхенд\)/ }).click();
  // Opened from the list the sheet is on Home, in Read mode; the checks below use the editor.
  await expect(dm).toHaveURL(/\/home$/);
  await openPage(dm, 'Stats', true);
  await expect(dm.getByText('Strength (STR) (Сила)')).toBeVisible();
  await openPage(dm, 'Skills', true);
  // The skill label is a glossary term: Russian form after it, definition on hover.
  const perception = dm.locator('span[title]', { hasText: 'Perception (WIS) (Наблюдательность)' });
  await expect(perception).toBeVisible();
  await expect(perception).toHaveAttribute('title', /How well a character notices things/);
  // The description is shown in Russian, with a way back to the original.
  await openPage(dm, 'Open Character History', true);
  await expect(dm.getByText('Лунная эльфийка').first()).toBeVisible();
  await dm.getByRole('button', { name: 'Show original' }).click();
  await expect(dm.getByRole('textbox', { name: 'Description', exact: true })).toContainText('A moon elf of 120 years');
  await dm.screenshot({ path: path.join(shots, 'phase1-sheet-russian.png'), fullPage: true });
  await dm.getByLabel('Reading language').selectOption('en');
  await expect(dm.getByText('Strength (STR) (Сила)')).toHaveCount(0);
});
