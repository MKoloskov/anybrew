import { expect, test } from '@playwright/test';
import path from 'node:path';

const shots = path.resolve(import.meta.dirname, 'screenshots');

test('DM sets up, invites a player, and the player never sees DM-only content', async ({ browser }) => {
  // ---- DM: first-run setup ----
  const dmContext = await browser.newContext({ permissions: ['clipboard-read', 'clipboard-write'] });
  const dm = await dmContext.newPage();
  await dm.goto('/');
  await expect(dm.getByRole('heading', { name: 'Set up AnyBrew' })).toBeVisible();
  await dm.getByLabel('Login name').fill('dm');
  await dm.getByLabel('Name shown to players').fill('Max');
  await dm.getByLabel('Password').fill('dm-password');
  await dm.getByLabel('System name').fill('Faerun Reboot');
  await dm.getByRole('button', { name: 'Create' }).click();
  await expect(dm.getByRole('heading', { name: 'Faerun Reboot' })).toBeVisible();

  // ---- DM: two campaigns inside the system, and an invite link into each ----
  await dm.getByRole('link', { name: 'People' }).click();
  for (const name of ['Heart of Anauroch', 'Second Table']) {
    await dm.getByPlaceholder('New campaign name…').fill(name);
    await dm.getByPlaceholder('New campaign name…').press('Enter');
    await expect(dm.getByText(name, { exact: true }).first()).toBeVisible();
  }
  const inviteInto = async (campaign: string) => {
    await dm.getByLabel('Campaign for the new player').selectOption({ label: `Into: ${campaign}` });
    await dm.getByRole('button', { name: 'New player link' }).click();
    const row = dm.locator('li', { hasText: `Player · ${campaign}` });
    const url = await row.locator('input[readonly]').inputValue();
    expect(url).toContain('/invite/');
    return url;
  };
  const inviteUrl = await inviteInto('Heart of Anauroch');
  const outsiderUrl = await inviteInto('Second Table');

  // ---- Player: joins through the link, in a separate browser ----
  const playerContext = await browser.newContext({ viewport: { width: 390, height: 800 } }); // phone width
  const player = await playerContext.newPage();
  await player.goto(inviteUrl);
  await expect(player.getByRole('heading', { name: 'Join Faerun Reboot' })).toBeVisible();
  await expect(player.getByText('in the campaign Heart of Anauroch')).toBeVisible();
  await player.getByLabel('Login name').fill('elara');
  await player.getByLabel('Name shown to others').fill('Elara');
  await player.getByLabel('Password').fill('elara-password');
  await player.getByRole('button', { name: 'Create account' }).click();
  await expect(player.getByText('No characters yet.')).toBeVisible();

  // ---- A player of the other campaign ----
  const outsiderContext = await browser.newContext();
  const outsider = await outsiderContext.newPage();
  await outsider.goto(outsiderUrl);
  await outsider.getByLabel('Login name').fill('brann');
  await outsider.getByLabel('Name shown to others').fill('Brann');
  await outsider.getByLabel('Password').fill('brann-password');
  await outsider.getByRole('button', { name: 'Create account' }).click();
  await expect(outsider.getByText('No characters yet.')).toBeVisible();

  // ---- DM: a rules note outside campaigns, open to everyone ----
  await dm.getByRole('link', { name: 'Notes' }).click();
  await dm.getByPlaceholder('New note…').fill('Grappling rules');
  await dm.getByRole('button', { name: 'Add' }).click();
  await dm.getByTitle('Who can see this', { exact: true }).first().click();
  await dm.getByLabel('Everyone').click();
  await expect(dm.getByLabel('Everyone')).toBeChecked();
  await dm.mouse.click(5, 5);

  // ---- DM: a campaign note with public and secret parts ----
  await dm.getByLabel('Campaign filter').selectOption({ label: 'Campaign: Heart of Anauroch' });
  await dm.getByPlaceholder('New note…').fill('The Devil Contract');
  await dm.getByRole('button', { name: 'Add' }).click();
  // The editor of the previous note is still on screen until the new one opens.
  // The new note was filed under the campaign chosen in the filter.
  await expect(dm.getByLabel('Heart of Anauroch')).toBeChecked();
  const summary = dm.locator('div.mb-3', { hasText: 'Summary' }).locator('input.input');
  await summary.fill('Signed in blood');
  await summary.blur();
  const secrets = dm.locator('div.mb-3', { hasText: 'Secrets' }).locator('textarea');
  await secrets.fill('The patron is lying to her');
  await secrets.blur();

  await expect(dm.getByLabel('Heart of Anauroch')).toBeChecked();

  // Still DM-only: the player sees the rules note but not the campaign note.
  await player.getByRole('link', { name: 'Notes' }).click();
  await expect(player.getByRole('link', { name: /Grappling rules/ })).toBeVisible();
  await expect(player.getByText('The Devil Contract')).toHaveCount(0);

  // Show the note to everyone (the first eye button is the note's own audience).
  await dm.getByTitle('Who can see this', { exact: true }).first().click();
  // The choice is saved on the server first, so the radio button fills in a moment later.
  await dm.getByLabel('Everyone').click();
  await expect(dm.getByLabel('Everyone')).toBeChecked();
  await dm.mouse.click(5, 5);
  await dm.screenshot({ path: path.join(shots, 'dm-note-desktop.png'), fullPage: true });

  // ---- Player: sees the public part only ----
  await player.reload();
  await player.getByRole('link', { name: /The Devil Contract/ }).click();
  await expect(player.locator('input[value="Signed in blood"]')).toBeVisible();
  await expect(player.getByText('DM notes')).toHaveCount(0);
  await expect(player.getByText('Secrets')).toHaveCount(0);
  expect(await player.content()).not.toContain('The patron is lying');
  await expect(player.getByTitle(/Who can see this/)).toHaveCount(0);
  await expect(player.getByRole('link', { name: 'Data' })).toHaveCount(0);
  await player.screenshot({ path: path.join(shots, 'player-note-phone.png'), fullPage: true });

  // ---- The player of the other campaign sees the rules, and nothing of Heart of Anauroch ----
  await outsider.getByRole('link', { name: 'Notes' }).click();
  await expect(outsider.getByRole('link', { name: /Grappling rules/ })).toBeVisible();
  await expect(outsider.getByText('The Devil Contract')).toHaveCount(0);
  await outsider.getByRole('link', { name: 'People' }).click();
  await expect(outsider.getByText('Second Table').first()).toBeVisible();
  expect(await outsider.content()).not.toContain('Heart of Anauroch');
  expect(await outsider.content()).not.toContain('Elara');

  // ---- DM: history shows the edits, and one can be undone ----
  await dm.getByRole('button', { name: 'History' }).click();
  await expect(dm.getByText('Signed in blood').last()).toBeVisible();
  await dm.screenshot({ path: path.join(shots, 'dm-history-desktop.png'), fullPage: true });
  await dm.getByRole('button', { name: 'Undo this' }).nth(1).click(); // the Summary edit
  await expect(dm.locator('div.mb-3', { hasText: 'Summary' }).locator('input.input')).toHaveValue('');

  // ---- Other screens, for the screenshots ----
  await dm.getByRole('link', { name: 'People' }).click();
  // The DM's page was open before Elara joined; she appears on the next 10-second refresh.
  await expect(dm.getByText('Elara', { exact: true }).first()).toBeVisible({ timeout: 15_000 });
  await dm.screenshot({ path: path.join(shots, 'dm-people-desktop.png'), fullPage: true });
  await dm.getByRole('link', { name: 'Data' }).click();
  await dm.screenshot({ path: path.join(shots, 'dm-data-desktop.png'), fullPage: true });

  // ---- Logging out returns to the login screen ----
  await player.getByRole('button', { name: '← Back' }).click();
  await player.getByRole('button', { name: 'Log out' }).click();
  await expect(player.getByRole('heading', { name: 'Log in' })).toBeVisible();
  await player.screenshot({ path: path.join(shots, 'login-phone.png') });
});
