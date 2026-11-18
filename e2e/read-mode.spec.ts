import { expect, test } from '@playwright/test';
import path from 'node:path';
import { openPage } from './sheet-pages';

const shots = path.resolve(import.meta.dirname, 'screenshots');

// Runs after phase2-library.spec.ts in the same database: the feature Metamagic (Sorcerer, level 3) and Esther Silverhand exist.
test('pages open for reading; Edit switches to the full editor; counters stay usable while reading', async ({ browser }) => {
  const context = await browser.newContext();
  const dm = await context.newPage();
  await dm.goto('/');
  await dm.getByLabel('Login name').fill('dm');
  await dm.getByLabel('Password').fill('dm-password');
  await dm.getByRole('button', { name: 'Log in' }).click();

  // ---- A feature opens for reading: plain text, empty fields hidden, no inputs ----
  await dm.getByRole('link', { name: 'Features', exact: true }).click();
  await dm.locator('[data-feature="Metamagic"]').click();
  const editor = dm.locator('[data-editor]');
  await expect(editor).toHaveAttribute('data-editor', 'read');
  await expect(editor.getByRole('heading', { name: 'Metamagic' })).toBeVisible();
  await expect(editor.getByText('Sorcerer', { exact: true })).toBeVisible();
  await expect(editor.getByText('Description', { exact: true })).toHaveCount(0); // empty, so hidden
  await expect(editor.locator('input:not([type=search]), textarea, select, [contenteditable=true]')).toHaveCount(0);
  await expect(editor.getByRole('button', { name: 'Delete' })).toHaveCount(0);
  await dm.screenshot({ path: path.join(shots, 'read-feature.png'), fullPage: true });

  // ---- Edit shows every field as an input; a change shows up when back to reading ----
  await editor.getByRole('button', { name: 'Edit', exact: true }).click();
  await expect(editor).toHaveAttribute('data-editor', 'edit');
  await expect(editor.getByLabel('Name', { exact: true })).toHaveValue('Metamagic');
  await expect(editor.getByText('Description', { exact: true })).toBeVisible();
  const action = editor.locator('div.match-target', { hasText: 'Action' }).locator('input').first();
  await action.fill('Bonus action');
  await action.blur();
  await expect(editor.getByRole('button', { name: 'Delete' })).toBeVisible();
  await editor.getByRole('button', { name: 'Done' }).click();
  await expect(editor).toHaveAttribute('data-editor', 'read');
  await expect(editor.getByText('Bonus action', { exact: true })).toBeVisible();

  // ---- Another page opens for reading again ----
  await dm.getByRole('link', { name: 'Characters', exact: true }).click();
  await dm.getByRole('link', { name: /Esther Silverhand/ }).click();
  await expect(editor).toHaveAttribute('data-editor', 'read');

  // ---- Counters stay usable while reading: inspiration boxes tick without Edit ----
  await openPage(dm, 'Stats');
  const inspiration = editor.locator('div.match-target', { hasText: 'Inspiration' });
  await inspiration.getByRole('button', { name: '1 of 4' }).click();
  await expect(inspiration.getByRole('button', { name: '1 of 4' })).toHaveAttribute('aria-pressed', 'true');
  await inspiration.getByRole('button', { name: '1 of 4' }).click();
  await expect(inspiration.getByRole('button', { name: '1 of 4' })).toHaveAttribute('aria-pressed', 'false');
  await dm.screenshot({ path: path.join(shots, 'read-character.png'), fullPage: true });

  // ---- A new page opens straight in Edit ----
  await dm.getByRole('link', { name: '← Characters' }).click();
  await dm.getByPlaceholder('New character…').fill('Read Mode Tester');
  await dm.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(editor).toHaveAttribute('data-editor', 'edit');
  await expect(editor.getByLabel('Name', { exact: true })).toHaveValue('Read Mode Tester');
  dm.once('dialog', (d) => d.accept());
  // Delete is under "Sheet settings" at the bottom of Basic Info, where a new character opens.
  await editor.locator('[data-sheet-settings]').getByRole('button', { name: 'Delete' }).click();
  await context.close();
});
