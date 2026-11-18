import { expect, test } from '@playwright/test';
import path from 'node:path';
import { openPage } from './sheet-pages';

const shots = path.resolve(import.meta.dirname, 'screenshots');
const classFile = path.resolve(import.meta.dirname, 'fixtures/alternate-wizard.class.json');

// Runs after phase0 to phase2 in the same database: the DM account and "Esther Silverhand" exist.
test('classes: a class file is reviewed and imported, then taken on a character sheet', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const dm = await context.newPage();
  dm.on('dialog', (d) => d.accept());
  await dm.goto('/');
  await dm.getByLabel('Login name').fill('dm');
  await dm.getByLabel('Password').fill('dm-password');
  await dm.getByRole('button', { name: 'Log in' }).click();

  // ---- Rules: the review shows what the file holds before anything is saved ----
  await dm.getByRole('link', { name: 'Rules', exact: true }).click();
  await dm.locator('[data-class-file]').setInputFiles(classFile);
  const review = dm.getByRole('dialog', { name: 'Review the class file' });
  await expect(review.getByRole('heading', { name: 'Alternate Wizard' })).toBeVisible();
  await expect(review).toContainText('Hit die: d6');
  await expect(review).toContainText('Saving throws: INT, WIS');
  await expect(review).toContainText('Class table: 4 levels');
  await expect(review).toContainText('Subclasses: Evoker, Diviner');
  await expect(review).toContainText('5 of 5 will be imported');
  await review.getByLabel('Import Arcane Recovery').uncheck();
  await expect(review).toContainText('4 of 5 will be imported');
  await dm.screenshot({ path: path.join(shots, 'class-review.png'), fullPage: true });
  await review.getByRole('button', { name: 'Import', exact: true }).click();

  // The class is a rules document now, with its table and class section.
  await expect(dm.getByRole('heading', { name: 'Alternate Wizard' })).toBeVisible();
  await expect(dm.locator('[data-entity="Alternate Wizard"]')).toContainText('Class');
  await dm.screenshot({ path: path.join(shots, 'class-rule.png'), fullPage: true });

  // Its features are in the library, filed under the class; the one left out is not.
  await dm.getByRole('link', { name: 'Features', exact: true }).click();
  await dm.getByLabel('Class', { exact: true }).selectOption('Alternate Wizard');
  await expect(dm.locator('[data-features] tbody tr')).toHaveCount(4);
  await expect(dm.locator('[data-feature="Arcane Recovery"]')).toHaveCount(0);

  // ---- The character takes the class ----
  await dm.getByRole('link', { name: 'Characters', exact: true }).click();
  await dm.getByRole('link', { name: /Esther Silverhand/ }).click();
  await openPage(dm, 'Basic Info', true);
  const classes = dm.locator('[data-classes]');
  await classes.getByLabel('Add a class').selectOption({ label: 'Alternate Wizard' });
  const wizard = classes.locator('[data-class="Alternate Wizard"]');
  await expect(wizard).toContainText('Hit die d6');
  await wizard.getByLabel('Arcane Tradition of Alternate Wizard').selectOption('Evoker');
  const level = wizard.getByLabel('Level in Alternate Wizard');
  await level.fill('2');
  await level.blur();
  await expect(wizard).toContainText('Cantrips Known: 3');
  await expect(wizard).toContainText('1st-circle slots: 3');

  // The sheet took the level, hit dice and saving throws from the class.
  await openPage(dm, 'Stats', true);
  const field = (label: string) => dm.locator('div.match-target', { hasText: label }).locator('input').first();
  await expect(field('Level')).toHaveValue('2');
  await expect(field('Hit Dice (dice)')).toHaveValue('2d6');
  await expect(dm.locator('.sheet-row', { hasText: 'Save – INT' }).getByRole('checkbox')).toBeChecked();
  await expect(dm.locator('.sheet-row', { hasText: 'Save – STR' }).getByRole('checkbox')).not.toBeChecked();

  // Class features up to level 2 on Class Abilities; the Evoker's on Subclass Abilities, without the
  // Diviner's; nothing of level 4 yet.
  await openPage(dm, 'Class Abilities');
  const features = dm.locator('[data-links="Class features"]');
  await expect(features.locator('[data-link="Spellcasting"]')).toContainText('from class');
  await expect(features.locator('[data-link="Sculpt Spells"]')).toHaveCount(0);
  await expect(features.locator('[data-link="Ability Score Improvement"]')).toHaveCount(0);
  await expect(features.getByText('Alternate Wizard features')).toBeVisible();
  await openPage(dm, 'Subclass Abilities');
  const subclass = dm.locator('[data-links="Subclass features"]');
  await expect(subclass.locator('[data-link="Sculpt Spells"]')).toContainText('from class');
  await expect(subclass.locator('[data-link="Portent"]')).toHaveCount(0);
  await expect(subclass.locator('[data-link="Spellcasting"]')).toHaveCount(0);

  // Level 4 brings the next feature in by itself.
  await openPage(dm, 'Basic Info', true);
  await level.fill('4');
  await level.blur();
  await expect(wizard).toContainText('Cantrips Known: 4');
  await openPage(dm, 'Class Abilities');
  await expect(features.locator('[data-link="Ability Score Improvement"]')).toBeVisible();
  await openPage(dm, 'Basic Info');
  await classes.scrollIntoViewIfNeeded();
  await dm.screenshot({ path: path.join(shots, 'class-on-sheet.png'), fullPage: true });
});
