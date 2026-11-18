import { expect, type Page } from '@playwright/test';

/**
 * Opens a page of the character sheet from its menu on the right (U3). Every page opens for
 * reading; with `edit` the Edit button is pressed after it.
 */
export async function openPage(page: Page, label: string, edit = false) {
  // While a search is on, the link carries the number of matches on its page after the label.
  const name = new RegExp(`^${label}(\\s*\\d+)?$`);
  await page.getByRole('navigation', { name: 'Pages of the sheet' }).getByRole('link', { name }).click();
  await expect(page.locator('[data-editor]')).toHaveAttribute('data-editor', 'read');
  if (edit) await page.getByRole('button', { name: 'Edit', exact: true }).click();
  await expect(page.locator('[data-editor]')).toHaveAttribute('data-editor', edit ? 'edit' : 'read');
}
