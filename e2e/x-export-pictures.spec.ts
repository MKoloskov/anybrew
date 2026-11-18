import { expect, test, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

// Export and import with pictures (task F3).
// Runs last ("x-" sorts after the other files) in the same database, because it adds an imported System
// and the other files take the first System of the list.

// A 2×2 red PNG.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFElEQVR4nGP8z8Dwn4GBgYGJAQoAHxcCAr7pnmkAAAAASUVORK5CYII=', 'base64');

async function api<T = any>(page: Page, name: string, input: unknown, query = false): Promise<T> {
  const res = query
    ? await page.request.get(`/trpc/${name}?input=${encodeURIComponent(JSON.stringify(input))}`)
    : await page.request.post(`/trpc/${name}`, { data: input });
  expect(res.ok(), `${name}: ${await res.text()}`).toBeTruthy();
  return (await res.json()).result.data as T;
}

test('export with pictures as a ZIP, import it as a new System, and the portrait is there', async ({ browser }, testInfo) => {
  const context = await browser.newContext();
  const dm = await context.newPage();
  await dm.goto('/');
  await dm.getByLabel('Login name').fill('dm');
  await dm.getByLabel('Password').fill('dm-password');
  await dm.getByRole('button', { name: 'Log in' }).click();
  await expect(dm.locator('header.bar')).toBeVisible();

  // ---- A character with a portrait ----
  const [{ id: systemId }] = await api<{ id: string }[]>(dm, 'system.list', undefined, true);
  const { id } = await api<{ id: string }>(dm, 'entity.create', { systemId, typeKey: 'character', name: 'Pictured Exporter' });
  const upload = await dm.request.post(`/api/upload?entityId=${id}&fieldId=portrait`, { headers: { 'content-type': 'image/png' }, data: PNG });
  expect(upload.ok()).toBeTruthy();

  // ---- Export with pictures: a ZIP ----
  await dm.getByRole('link', { name: 'Data' }).click();
  const include = dm.getByLabel('Include pictures');
  await expect(include).toBeChecked();
  const [zipDownload] = await Promise.all([dm.waitForEvent('download'), dm.getByRole('button', { name: 'Download export' }).click()]);
  expect(zipDownload.suggestedFilename()).toMatch(/\.zip$/);
  const zipPath = testInfo.outputPath(zipDownload.suggestedFilename());
  await zipDownload.saveAs(zipPath);
  expect(fs.statSync(zipPath).size).toBeGreaterThan(PNG.length);

  // ---- Export without pictures: the plain JSON file, as before ----
  await include.uncheck();
  const [jsonDownload] = await Promise.all([dm.waitForEvent('download'), dm.getByRole('button', { name: 'Download export' }).click()]);
  expect(jsonDownload.suggestedFilename()).toMatch(/\.json$/);

  // ---- Import the ZIP: a new System opens, and the card shows the portrait ----
  await dm.locator('input[type=file]').setInputFiles(zipPath);
  await expect(dm).not.toHaveURL(new RegExp(`/s/${systemId}`));
  await dm.getByRole('link', { name: 'Characters' }).click();
  const portrait = dm.locator('li[data-entity="Pictured Exporter"] img');
  await expect(portrait).toBeVisible();
  await expect.poll(() => portrait.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(2);
  // It is the copy's own picture, not the original's.
  const original = (await api<{ values: Record<string, unknown> }>(dm, 'entity.get', { id }, true)).values.portrait as string;
  expect(await portrait.getAttribute('src')).not.toContain(original);

  // ---- A file that is not an export is refused with a message ----
  await dm.getByRole('link', { name: 'Data' }).click();
  await dm.locator('input[type=file]').setInputFiles({ name: 'broken.zip', mimeType: 'application/zip', buffer: Buffer.from('not a zip') });
  await expect(dm.getByText('This is not a system export file')).toBeVisible();
});
