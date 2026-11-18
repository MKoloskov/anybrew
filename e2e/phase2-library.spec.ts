import { expect, test } from '@playwright/test';
import path from 'node:path';
import { openPage } from './sheet-pages';

const shots = path.resolve(import.meta.dirname, 'screenshots');

// Runs after phase0 and phase1 in the same database: the DM account and the character "Esther Silverhand" exist.
test('library: a feature and an item are added to a character from its sheet', async ({ browser }) => {
  const context = await browser.newContext();
  const dm = await context.newPage();
  dm.on('dialog', (d) => d.accept());
  await dm.goto('/');
  await dm.getByLabel('Login name').fill('dm');
  await dm.getByLabel('Password').fill('dm-password');
  await dm.getByRole('button', { name: 'Log in' }).click();

  // ---- The libraries ----
  await dm.getByRole('link', { name: 'Features', exact: true }).click();
  await dm.getByPlaceholder('New feature…').fill('Metamagic');
  await dm.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(dm.getByLabel('Name', { exact: true })).toHaveValue('Metamagic');
  const type = dm.locator('div.match-target', { hasText: 'Type' }).locator('input').first();
  await type.fill('Class feature');
  await type.blur();
  const ofClass = dm.locator('div.match-target', { hasText: 'Class' }).locator('input').first();
  await ofClass.fill('Sorcerer');
  await ofClass.blur();
  const tier = dm.locator('div.match-target', { hasText: 'Level gained' }).locator('input').first();
  await tier.fill('3');
  await tier.blur();

  await dm.getByRole('link', { name: 'Items', exact: true }).click();
  await dm.getByPlaceholder('New item…').fill('Potion of Healing');
  await dm.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(dm.getByLabel('Name', { exact: true })).toHaveValue('Potion of Healing');

  // ---- On the character ----
  await dm.getByRole('link', { name: 'Characters', exact: true }).click();
  await dm.getByRole('link', { name: /Esther Silverhand/ }).click();
  // Metamagic is a Sorcerer class feature, so it is listed on Class Abilities; items on Inventory.
  await openPage(dm, 'Class Abilities', true);
  const features = dm.locator('[data-links="Class features"]');
  await features.getByRole('button', { name: '+ Add feature' }).click();
  await features.getByLabel('Class features to add').selectOption({ label: 'Metamagic' });
  await features.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(features.locator('[data-link="Metamagic"]')).toContainText('[3]');
  await expect(features.getByText('Sorcerer features')).toBeVisible();

  await openPage(dm, 'Inventory', true);
  const items = dm.locator('[data-links="Items"]');
  await items.getByRole('button', { name: '+ Add item' }).click();
  await items.getByLabel('Items to add').selectOption({ label: 'Potion of Healing' });
  await items.getByLabel('Quantity').fill('3');
  await items.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(items.locator('[data-link="Potion of Healing"]')).toContainText('× 3');
  await dm.screenshot({ path: path.join(shots, 'phase2-linked.png'), fullPage: true });

  // The name opens the library page, which shows who has it.
  await openPage(dm, 'Class Abilities');
  await features.getByRole('link', { name: 'Metamagic' }).click();
  await expect(dm.getByRole('heading', { name: 'Metamagic' })).toBeVisible();
  await expect(dm.getByText('Characters that have it')).toBeVisible();
  await dm.getByRole('link', { name: /Esther Silverhand/ }).last().click();
  await expect(dm.getByRole('heading', { name: 'Esther Silverhand' })).toBeVisible();

  // Removing it from the character leaves it in the library.
  await openPage(dm, 'Class Abilities', true);
  await features.getByRole('button', { name: 'Remove Metamagic' }).click();
  await expect(features.locator('[data-link="Metamagic"]')).toHaveCount(0);
  await dm.getByRole('link', { name: '← Characters' }).click();
  await dm.getByRole('link', { name: 'Features', exact: true }).click();
  await expect(dm.getByRole('link', { name: /Metamagic/ })).toBeVisible();
});

test('features: the table filters and sorts, folders file by class, and a feature is given to a character from its page', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const dm = await context.newPage();
  dm.on('dialog', (d) => d.accept());
  await dm.goto('/');
  await dm.getByLabel('Login name').fill('dm');
  await dm.getByLabel('Password').fill('dm-password');
  await dm.getByRole('button', { name: 'Log in' }).click();
  await dm.getByRole('link', { name: 'Features', exact: true }).click();

  // Two more features next to Metamagic (a Sorcerer class feature of level 3).
  const add = async (name: string, type: string, ofClass: string, level: string) => {
    await dm.getByPlaceholder('New feature…').fill(name);
    await dm.getByRole('button', { name: 'Add', exact: true }).click();
    await expect(dm.getByLabel('Name', { exact: true })).toHaveValue(name);
    for (const [label, value] of [['Type', type], ['Class', ofClass], ['Level gained', level]] as const) {
      if (!value) continue;
      const box = dm.locator('div.match-target', { hasText: label }).locator('input').first();
      await box.fill(value);
      await box.blur();
    }
  };
  await add('Alert', 'Feat', '', '');
  await add('Font of Magic', 'Class feature', 'Sorcerer', '2');
  await add('Stunning Strike', 'Class feature', 'Monk', '5');

  const table = dm.locator('[data-features="table"]');
  const names = () => table.locator('tbody tr').evaluateAll((rows) => rows.map((r) => r.getAttribute('data-feature')));
  await expect(table.locator('tbody tr')).toHaveCount(4);

  // Filter by class, then sort by level, highest first.
  await table.getByLabel('Class', { exact: true }).selectOption('Sorcerer');
  await expect(table.locator('tbody tr')).toHaveCount(2);
  await table.getByRole('button', { name: 'Lvl' }).click();
  expect(await names()).toEqual(['Font of Magic', 'Metamagic']);
  await table.getByRole('button', { name: 'Lvl' }).click();
  expect(await names()).toEqual(['Metamagic', 'Font of Magic']);
  await table.getByRole('button', { name: 'Reset filters' }).click();
  await table.getByLabel('Type', { exact: true }).selectOption('Feat');
  expect(await names()).toEqual(['Alert']);
  await table.getByRole('button', { name: 'Reset filters' }).click();
  await table.getByLabel('Search features').fill('stun');
  expect(await names()).toEqual(['Stunning Strike']);
  await table.getByLabel('Search features').fill('');

  // Give the feat to a character from the feat's own page, then filter by that character.
  await table.locator('[data-feature="Alert"]').click();
  await expect(dm.getByRole('heading', { name: 'Alert' })).toBeVisible();
  await dm.getByRole('button', { name: 'Edit', exact: true }).click();
  const holders = dm.locator('[data-links="Characters"]');
  await holders.getByRole('button', { name: '+ Add character' }).click();
  await holders.getByLabel('Characters to add').selectOption({ label: 'Esther Silverhand' });
  await holders.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(holders.locator('[data-link="Esther Silverhand"]')).toBeVisible();
  await table.getByLabel('Character', { exact: true }).selectOption({ label: 'Esther Silverhand' });
  expect(await names()).toEqual(['Alert']);
  await expect(table.locator('[data-feature="Alert"]')).toContainText('Esther');
  await table.getByRole('button', { name: 'Reset filters' }).click();
  await dm.screenshot({ path: path.join(shots, 'features-table.png'), fullPage: true });

  // Folders: Class features → class → features; feats are their own folder.
  await dm.getByRole('button', { name: 'Folders' }).click();
  const folders = dm.locator('[data-features="folders"]');
  const classFolder = folders.locator('[data-folder="Class features"]');
  await expect(classFolder.locator('[data-folder="Sorcerer"]').getByRole('link')).toHaveText([/\[2\]\s*Font of Magic/, /\[3\]\s*Metamagic/]);
  await expect(classFolder.locator('[data-folder="Monk"]').getByRole('link')).toHaveText([/Stunning Strike/]);
  await expect(folders.locator('[data-folder="Feats"]').getByRole('link')).toHaveText([/Alert/]);
  await expect(classFolder.getByRole('link', { name: /Alert/ })).toHaveCount(0);
  await dm.screenshot({ path: path.join(shots, 'features-folders.png'), fullPage: true });
  await folders.getByRole('button', { name: 'Table' }).click();
  await expect(dm.locator('[data-features="table"]')).toBeVisible();
});

test('characters: an Aux character is listed among the Aux', async ({ browser }) => {
  const context = await browser.newContext();
  const dm = await context.newPage();
  dm.on('dialog', (d) => d.accept());
  await dm.goto('/');
  await dm.getByLabel('Login name').fill('dm');
  await dm.getByLabel('Password').fill('dm-password');
  await dm.getByRole('button', { name: 'Log in' }).click();

  await dm.getByPlaceholder('New character…').fill('Gate Guard');
  await dm.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(dm.getByLabel('Name', { exact: true })).toHaveValue('Gate Guard');
  // Kind is chosen under "Sheet settings" at the bottom of Basic Info.
  await dm.locator('[data-sheet-settings]').getByRole('button', { name: 'Aux', exact: true }).click();
  await expect(dm.locator('[data-kind="aux"]')).toBeVisible();

  // Back on the list, the new character sits among the Aux, apart from the others.
  await dm.getByRole('link', { name: '← Characters' }).click();
  await expect(dm.locator('[data-kind-group="aux"] [data-entity="Gate Guard"]')).toBeVisible();
  await expect(dm.locator('[data-kind-group="pc"] [data-entity="Gate Guard"], [data-kind-group="npc"] [data-entity="Gate Guard"]')).toHaveCount(0);
  await dm.screenshot({ path: path.join(shots, 'characters-folders.png'), fullPage: true });
});
