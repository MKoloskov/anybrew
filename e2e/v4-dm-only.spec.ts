import { expect, test, type Page } from '@playwright/test';
import path from 'node:path';
import { openPage } from './sheet-pages';

const shots = path.resolve(import.meta.dirname, 'screenshots');

// Runs after phase0.spec.ts in the same database: the DM "dm", Elara (Heart of Anauroch) and Brann (Second Table) exist.

/** Calls the server the way the app does, with the page's own login. */
async function api<T = any>(page: Page, name: string, input: unknown, query = false): Promise<T> {
  const res = query
    ? await page.request.get(`/trpc/${name}?input=${encodeURIComponent(JSON.stringify(input))}`)
    : await page.request.post(`/trpc/${name}`, { data: input });
  expect(res.ok(), `${name}: ${await res.text()}`).toBeTruthy();
  return (await res.json()).result.data as T;
}

async function login(page: Page, name: string, password: string) {
  await page.goto('/');
  await page.getByLabel('Login name').fill(name);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Log in' }).click();
  await expect(page.locator('header.bar')).toBeVisible();
}

const ALL = { all: true, players: [], parties: [] };
const DM_ONLY = { all: false, players: [], parties: [] };

test('DM-only style: the DM sees tint, outline and chip on what players cannot see; a player sees none of it', async ({ browser }) => {
  const dmContext = await browser.newContext();
  const dm = await dmContext.newPage();
  await login(dm, 'dm', 'dm-password');

  const [{ id: systemId }] = await api<{ id: string }[]>(dm, 'system.list', undefined, true);
  const system = await api<{ campaigns: { id: string; name: string }[]; members: { userId: string; displayName: string }[] }>(dm, 'system.get', { systemId }, true);
  const heart = system.campaigns.find((c) => c.name === 'Heart of Anauroch')!.id;
  const elaraId = system.members.find((m) => m.displayName === 'Elara')!.userId;
  const create = async (typeKey: string, name: string, campaignIds: string[] = []) =>
    (await api<{ id: string }>(dm, 'entity.create', { systemId, typeKey, name, campaignIds })).id;

  // ---- Three notes: DM only, open to everyone, shown to one player ----
  const vault = await create('note', 'Vault Plans');
  await api(dm, 'entity.setField', { id: vault, fieldId: 'summary', value: 'Three locks' });
  await api(dm, 'entity.setField', { id: vault, fieldId: 'dm_notes', value: 'The third lock is a mimic' });
  const notice = await create('note', 'Open Notice');
  await api(dm, 'entity.setVisibility', { id: notice, audience: ALL });
  const lead = await create('note', 'A Lead for Elara');
  await api(dm, 'entity.setVisibility', { id: lead, audience: { all: false, players: [elaraId], parties: [] } });

  // ---- Elara's character, open to the campaign, with one section opened to others; a villain nobody owns ----
  const sable = await create('character', 'Sable Varn', [heart]);
  await api(dm, 'entity.setOwner', { id: sable, ownerId: elaraId });
  await api(dm, 'entity.setVisibility', { id: sable, audience: ALL });
  await api(dm, 'entity.setFieldVisibility', { id: sable, nodeId: 'equipment', audience: ALL });
  await create('character', 'The Hidden Villain', [heart]);

  // ---- Two items of hers: one the players can see, one they cannot ----
  const ring = await create('item', 'Cursed Ring');
  await api(dm, 'entity.setVisibility', { id: ring, audience: DM_ONLY });
  const rope = await create('item', 'Hempen Rope');
  for (const toId of [ring, rope]) await api(dm, 'entity.link', { fromId: sable, kind: 'owns', toId, data: {} });

  // ---- DM, a list: the rows players cannot see are tinted and carry the chip ----
  await dm.goto(`/s/${systemId}/notes`);
  const row = (page: Page, name: string) => page.locator(`li[data-entity="${name}"]`);
  await expect(row(dm, 'Vault Plans').locator('[data-vis="secret"]')).toHaveText('DM only');
  await expect(row(dm, 'Vault Plans').locator('a')).toHaveClass(/secret-row/);
  await expect(row(dm, 'A Lead for Elara').locator('[data-vis="secret"]')).toHaveText('Elara');
  await expect(row(dm, 'Open Notice')).toBeVisible();
  await expect(row(dm, 'Open Notice').locator('[data-vis]')).toHaveCount(0);
  await expect(row(dm, 'Open Notice').locator('a')).not.toHaveClass(/secret-row/);

  // ---- DM, a page while reading: the chip beside the name, and on the DM-only section ----
  await row(dm, 'Vault Plans').locator('a').click();
  await expect(dm.locator('[data-editor]')).toHaveAttribute('data-editor', 'read');
  const nameLine = dm.locator('[data-name-line]');
  await expect(nameLine).toHaveClass(/secret/);
  await expect(nameLine.locator('[data-vis="secret"]')).toHaveText('DM only');
  const dmNotes = dm.locator('section[data-secret]');
  await expect(dmNotes).toHaveCount(1);
  await expect(dmNotes).toContainText('The third lock is a mimic');
  await expect(dmNotes.locator('[data-vis="secret"]')).toHaveText('DM only');
  // The dashed brass outline is really drawn.
  expect(await dmNotes.evaluate((el) => getComputedStyle(el).outlineStyle)).toBe('dashed');
  await dm.screenshot({ path: path.join(shots, 'v4-note-read-dm.png'), fullPage: true });

  // ---- DM, Edit: the same chip is the button that opens the choice ----
  await dm.getByRole('button', { name: 'Edit', exact: true }).click();
  const chipButton = nameLine.getByTitle('Who can see this', { exact: true });
  await expect(chipButton).toHaveAttribute('data-vis', 'secret');
  await expect(dmNotes.getByTitle('Who can see this', { exact: true })).toHaveText('DM only');
  await dm.screenshot({ path: path.join(shots, 'v4-note-edit-dm.png'), fullPage: true });
  await chipButton.click();
  await dm.getByLabel('Everyone').click();
  await expect(chipButton).toHaveAttribute('data-vis', 'open');
  await expect(chipButton).toHaveText('Everyone');
  await expect(nameLine).not.toHaveClass(/secret/);
  await dm.mouse.click(5, 5);
  // The list follows: the row is no longer marked. The DM-only section inside stays marked.
  await expect(row(dm, 'Vault Plans').locator('[data-vis]')).toHaveCount(0);
  await expect(dmNotes.locator('[data-vis="secret"]')).toHaveText('DM only');
  await dm.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(nameLine.locator('[data-vis="open"]')).toHaveText('Seen by: everyone');

  // ---- DM, the character cards ----
  await dm.goto(`/s/${systemId}/characters`);
  await expect(row(dm, 'The Hidden Villain').locator('[data-vis="secret"]')).toHaveText('DM only');
  await expect(row(dm, 'The Hidden Villain').locator('a')).toHaveClass(/secret/);
  await expect(row(dm, 'Sable Varn')).toBeVisible();
  await expect(row(dm, 'Sable Varn').locator('[data-vis]')).toHaveCount(0);
  await dm.screenshot({ path: path.join(shots, 'v4-cards-dm.png'), fullPage: true });

  // ---- DM, the sheet: only what the character's own player cannot see is marked ----
  await row(dm, 'Sable Varn').locator('a').click();
  await openPage(dm, 'DM Secrets');
  await expect(dm.locator('section[data-secret]').locator('[data-vis="secret"]')).toHaveText('DM only');
  await openPage(dm, 'Stats');
  // Ordinary owner-and-DM sections carry no mark at all.
  await expect(dm.locator('section.card').first()).toBeVisible();
  await expect(dm.locator('main [data-secret]')).toHaveCount(0);
  await expect(dm.locator('main section [data-vis]')).toHaveCount(0);
  await openPage(dm, 'Inventory');
  // A section opened to other players: the quiet chip, no tint.
  const equipment = dm.locator('section.card', { has: dm.getByRole('button', { name: /Equipment$/ }) });
  await expect(equipment.locator('[data-vis="open"]')).toHaveText('Also seen by: everyone');
  await expect(equipment).not.toHaveAttribute('data-secret', '');
  // An item her player cannot see is marked in her inventory.
  const link = (page: Page, name: string) => page.locator(`li[data-link="${name}"]`);
  await expect(link(dm, 'Cursed Ring').locator('[data-vis="secret"]')).toHaveText('DM only');
  await expect(link(dm, 'Hempen Rope')).toBeVisible();
  await expect(link(dm, 'Hempen Rope').locator('[data-vis]')).toHaveCount(0);
  await dm.screenshot({ path: path.join(shots, 'v4-inventory-dm.png'), fullPage: true });

  // ---- Elara: nothing is marked, and no audience reaches her browser ----
  const elaraContext = await browser.newContext({ viewport: { width: 390, height: 800 } }); // phone width
  const elara = await elaraContext.newPage();
  await login(elara, 'elara', 'elara-password');
  await elara.goto(`/s/${systemId}/notes`);
  await expect(row(elara, 'A Lead for Elara')).toBeVisible();
  await expect(elara.locator('[data-vis]')).toHaveCount(0);
  await expect(elara.locator('.secret, .secret-row')).toHaveCount(0);
  await row(elara, 'Vault Plans').locator('a').click();
  await expect(elara.getByText('Three locks')).toBeVisible();
  await expect(elara.locator('[data-vis]')).toHaveCount(0);
  await expect(elara.locator('.secret, .secret-row, [data-secret]')).toHaveCount(0);
  expect(await elara.content()).not.toContain('The third lock');

  await elara.goto(`/s/${systemId}/characters`);
  await expect(row(elara, 'Sable Varn')).toBeVisible();
  await expect(row(elara, 'The Hidden Villain')).toHaveCount(0);
  await expect(elara.locator('[data-vis]')).toHaveCount(0);
  await elara.goto(`/s/${systemId}/characters/${sable}/inventory`);
  await expect(link(elara, 'Hempen Rope')).toBeVisible();
  await expect(link(elara, 'Cursed Ring')).toHaveCount(0);
  await expect(elara.locator('[data-vis]')).toHaveCount(0);
  await expect(elara.locator('.secret, .secret-row, [data-secret]')).toHaveCount(0);
  await elara.screenshot({ path: path.join(shots, 'v4-inventory-player-phone.png'), fullPage: true });

  // The server sends her no audience with rows or links.
  const rows = await api<Record<string, unknown>[]>(elara, 'entity.list', { systemId }, true);
  expect(rows.length).toBeGreaterThan(0);
  for (const r of rows) expect(r.visibility).toBeUndefined();
  const links = await api<{ other: Record<string, unknown> }[]>(elara, 'entity.links', { id: sable }, true);
  expect(links.length).toBeGreaterThan(0);
  for (const l of links) expect(l.other.seenBy).toBeUndefined();
});
