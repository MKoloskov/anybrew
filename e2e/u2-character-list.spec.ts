import { expect, test, type Page } from '@playwright/test';
import path from 'node:path';

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

test('character list: cards, kind tabs, tag and name filters, card fields chosen by the DM', async ({ browser }) => {
  const dmContext = await browser.newContext();
  const dm = await dmContext.newPage();
  dm.on('dialog', (d) => d.accept());
  await login(dm, 'dm', 'dm-password');

  // ---- A second player in Heart of Anauroch, who will own a character ----
  await dm.getByRole('link', { name: 'People' }).click();
  await dm.getByLabel('Campaign for the new player').selectOption({ label: 'Into: Heart of Anauroch' });
  await dm.getByRole('button', { name: 'New player link' }).click();
  const inviteUrl = await dm.locator('li', { hasText: 'Player · Heart of Anauroch' }).last().locator('input[readonly]').inputValue();
  const miraContext = await browser.newContext({ viewport: { width: 390, height: 800 } }); // phone width
  const mira = await miraContext.newPage();
  await mira.goto(inviteUrl);
  await mira.getByLabel('Login name').fill('mira');
  await mira.getByLabel('Name shown to others').fill('Mira');
  await mira.getByLabel('Password').fill('mira-password');
  await mira.getByRole('button', { name: 'Create account' }).click();
  await expect(mira.locator('[data-character-list]')).toBeVisible();

  // ---- Three characters made through the server: a PC of Mira's, an NPC, an Aux ----
  const [{ id: systemId }] = await api<{ id: string }[]>(dm, 'system.list', undefined, true);
  const system = await api<{ campaigns: { id: string; name: string }[]; members: { userId: string; displayName: string }[] }>(dm, 'system.get', { systemId }, true);
  const heart = system.campaigns.find((c) => c.name === 'Heart of Anauroch')!.id;
  const miraId = system.members.find((m) => m.displayName === 'Mira')!.userId;
  const make = async (name: string, values: Record<string, unknown>, ownerId: string | null = null) => {
    const { id } = await api<{ id: string }>(dm, 'entity.create', { systemId, typeKey: 'character', name, campaignIds: [heart] });
    for (const [fieldId, value] of Object.entries(values)) await api(dm, 'entity.setField', { id, fieldId, value });
    if (ownerId) await api(dm, 'entity.setOwner', { id, ownerId });
    // Open to every player of the campaign; the server still sends other players only the Preview.
    await api(dm, 'entity.setVisibility', { id, audience: { all: true, players: [], parties: [] } });
  };
  await make('Ilyra Moonwhisper', { kind: 'pc', faction: 'Harpers', race: 'Moon elf', tags: ['Cormyr'] }, miraId);
  await make('Borin Ironfist', { kind: 'npc', faction: 'Zhentarim', race: 'Dwarf', tags: ['Cormyr', 'Zhentarim'] });
  await make('Ash the Stablehand', { kind: 'aux', race: 'Human' });

  // ---- DM: the list is a page of cards, PCs first, then NPCs, then Aux, alphabetical inside each ----
  await dm.getByRole('link', { name: 'Characters', exact: true }).click();
  await dm.reload(); // the list was loaded at login, before the characters above were made
  const list = dm.locator('[data-character-list]');
  await expect(list.locator('li[data-entity="Ilyra Moonwhisper"]')).toBeVisible();
  await expect(list.locator('[data-folder]')).toHaveCount(0); // the old folders are gone
  await expect(list.locator('[data-kind-group]')).toHaveCount(3);
  expect(await list.locator('[data-kind-group]').evaluateAll((els) => els.map((el) => el.getAttribute('data-kind-group')))).toEqual(['pc', 'npc', 'aux']);
  for (const kind of ['pc', 'npc', 'aux']) {
    const names = await list.locator(`[data-kind-group="${kind}"] li[data-entity]`).evaluateAll((els) => els.map((el) => el.getAttribute('data-entity')!));
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));
  }
  const ilyra = list.locator('li[data-entity="Ilyra Moonwhisper"]');
  await expect(ilyra).toContainText('Harpers'); // allegiance is always on the card
  await expect(ilyra.locator('[data-card-field]')).toHaveCount(0); // nothing further chosen yet

  // ---- DM: chooses Race and Owner for every card ----
  await dm.getByRole('button', { name: 'Card fields…' }).click();
  const chooser = dm.locator('[data-card-fields]');
  await chooser.getByLabel('Race').check();
  await expect(chooser.getByLabel('Race')).toBeChecked();
  await chooser.getByLabel('Owner').check();
  await expect(chooser.getByLabel('Owner')).toBeChecked();
  await expect(ilyra.locator('[data-card-field="race"]')).toHaveText(/Race:\s*Moon elf/);
  await expect(ilyra.locator('[data-card-field="owner"]')).toHaveText(/Owner:\s*Mira/);
  await dm.getByRole('button', { name: 'Card fields…' }).click();

  // ---- DM: tag chips narrow to characters with all ticked tags; tab counts follow ----
  await dm.locator('[data-tag="Cormyr"]').click();
  await expect(list.locator('li[data-entity]')).toHaveCount(2);
  await expect(dm.locator('[data-tab="all"]')).toHaveText(/All\s*2/);
  await expect(dm.locator('[data-tab="pc"]')).toHaveText(/PC\s*1/);
  await expect(dm.locator('[data-tab="npc"]')).toHaveText(/NPC\s*1/);
  await expect(dm.locator('[data-tab="aux"]')).toHaveText(/Aux\s*0/);
  await dm.locator('[data-tag="Zhentarim"]').click();
  await expect(list.locator('li[data-entity]')).toHaveCount(1);
  await expect(list.locator('li[data-entity="Borin Ironfist"]')).toBeVisible();
  await dm.locator('[data-tag="Zhentarim"]').click();

  // ---- DM: a kind tab and the name search ----
  await dm.locator('[data-tab="npc"]').click();
  await expect(list.locator('li[data-entity]')).toHaveCount(1);
  await expect(list.locator('h2')).toHaveCount(0); // a single kind needs no heading
  await dm.locator('[data-tab="all"]').click();
  await dm.getByLabel('Search characters').fill('ILY');
  await expect(list.locator('li[data-entity]')).toHaveCount(1);
  await expect(list.locator('li[data-entity="Ilyra Moonwhisper"]')).toBeVisible();
  await dm.screenshot({ path: path.join(shots, 'u2-list-dm-filtered.png'), fullPage: true });

  // ---- The filter settings survive a reload: they are remembered in this browser ----
  await dm.reload();
  await expect(dm.getByLabel('Search characters')).toHaveValue('ILY');
  await expect(dm.locator('[data-tag="Cormyr"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(list.locator('li[data-entity]')).toHaveCount(1);
  await dm.getByRole('button', { name: 'Reset filters' }).click();
  await expect(dm.locator('[data-tag="Cormyr"]')).toHaveAttribute('aria-pressed', 'false');
  await expect(list.locator('li[data-entity="Ash the Stablehand"]')).toBeVisible();
  await dm.screenshot({ path: path.join(shots, 'u2-list-dm.png'), fullPage: true });

  // ---- A card opens the sheet on its own page, and "← Characters" leads back ----
  await list.locator('li[data-entity="Borin Ironfist"] a').click();
  await expect(dm.locator('[data-entity-name]')).toHaveText('Borin Ironfist');
  await expect(dm.locator('[data-character-list]')).toHaveCount(0);
  await dm.getByRole('link', { name: '← Characters' }).click();
  await expect(dm.locator('[data-character-list]')).toBeVisible();

  // ---- Mira, the owner: her own filters (none yet), her character's tags, the chosen fields ----
  await mira.getByRole('link', { name: 'Characters', exact: true }).click();
  await mira.reload(); // her list was loaded when she joined; other people's changes otherwise arrive within 10 seconds
  const miraList = mira.locator('[data-character-list]');
  await expect(mira.getByLabel('Search characters')).toHaveValue('');
  const mine = miraList.locator('li[data-entity="Ilyra Moonwhisper"]');
  await expect(mine.locator('[data-card-field="race"]')).toHaveText(/Moon elf/);
  await expect(mine).toContainText('Harpers');
  await expect(mira.getByRole('button', { name: 'Card fields…' })).toHaveCount(0); // the DM's choice only
  // Borin's tags are not part of his Preview, so only Cormyr from her own character is offered.
  await expect(mira.locator('[data-tag]')).toHaveCount(1);
  await mira.locator('[data-tag="Cormyr"]').click();
  await expect(miraList.locator('li[data-entity]')).toHaveCount(1);
  await expect(mine).toBeVisible();
  await mira.screenshot({ path: path.join(shots, 'u2-list-owner-phone.png'), fullPage: true });

  // ---- Elara, another player of the campaign: the Preview only, no tags ----
  const elaraContext = await browser.newContext();
  const elara = await elaraContext.newPage();
  await login(elara, 'elara', 'elara-password');
  await elara.getByRole('link', { name: 'Characters', exact: true }).click();
  const theirs = elara.locator('li[data-entity="Ilyra Moonwhisper"]');
  await expect(theirs).toContainText('Harpers');
  await expect(theirs.locator('[data-card-field="race"]')).toHaveText(/Moon elf/);
  await expect(elara.locator('[data-tag="Cormyr"], [data-tag="Zhentarim"]')).toHaveCount(0);

  // ---- Brann, of the other campaign, does not see them at all ----
  const brannContext = await browser.newContext();
  const brann = await brannContext.newPage();
  await login(brann, 'brann', 'brann-password');
  await brann.getByRole('link', { name: 'Characters', exact: true }).click();
  await expect(brann.locator('[data-character-list]')).toBeVisible();
  await expect(brann.locator('li[data-entity="Ilyra Moonwhisper"], li[data-entity="Borin Ironfist"]')).toHaveCount(0);

  for (const c of [dmContext, miraContext, elaraContext, brannContext]) await c.close();
});
