import { expect, test, type Page } from '@playwright/test';
import path from 'node:path';

const shots = path.resolve(import.meta.dirname, 'screenshots');

// Player Requests (task U4a, PLAN.md 10.4).
// Runs after phase0.spec.ts in the same database: the DM "dm" and the players Elara and Brann exist.

async function login(page: Page, name: string, password: string) {
  await page.goto('/');
  await page.getByLabel('Login name').fill(name);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Log in' }).click();
  await expect(page.locator('header.bar')).toBeVisible();
}

const count = (page: Page) => page.locator('[data-requests-count]');
const row = (page: Page, subject: string) => page.locator(`li[data-request="${subject}"]`);

test('requests: a player writes, the DM answers and resolves; folders, the count, and nobody else reads it', async ({ browser }) => {
  // ---- Elara, on a phone, writes a request ----
  const elaraContext = await browser.newContext({ viewport: { width: 390, height: 800 } });
  const elara = await elaraContext.newPage();
  await login(elara, 'elara', 'elara-password');
  await elara.getByRole('link', { name: 'Requests' }).click();
  await expect(elara.locator('[data-requests] [data-empty]')).toContainText('No open requests.');
  await expect(count(elara)).toHaveCount(0);
  await elara.getByRole('link', { name: 'New request' }).click();
  await expect(elara.getByLabel('To player')).toHaveCount(0); // a player writes to the DM only
  await elara.getByLabel('Subject').fill('A new spell');
  await expect(elara.getByRole('button', { name: 'Send', exact: true })).toBeDisabled(); // no message yet
  await elara.getByRole('textbox', { name: 'Message' }).click();
  await elara.keyboard.type('May I learn Fireball at the next level?');
  await elara.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(elara.locator('[data-request-subject]')).toHaveText('A new spell');
  await expect(elara.locator('[data-message]')).toHaveCount(1);
  await expect(elara.locator('[data-message]')).toContainText('May I learn Fireball at the next level?');
  await expect(elara.getByRole('button', { name: 'Mark resolved' })).toHaveCount(0);
  await expect(elara.getByRole('button', { name: 'Delete' })).toHaveCount(0);
  await expect(count(elara)).toHaveCount(0); // her own message waits for the DM, not for her

  // ---- The DM sees the count, opens the request and answers with formatted text ----
  const dmContext = await browser.newContext();
  const dm = await dmContext.newPage();
  dm.on('dialog', (d) => d.accept());
  await login(dm, 'dm', 'dm-password');
  await expect(count(dm)).toHaveText('1');
  await dm.getByRole('link', { name: 'Requests' }).click();
  await expect(dm.locator('[data-folder="open"]')).toHaveText(/Open\s*1/);
  await expect(row(dm, 'A new spell')).toContainText('Elara');
  await expect(row(dm, 'A new spell').locator('[data-request-state]')).toHaveText('Waiting for you');
  await row(dm, 'A new spell').getByRole('link').click();
  await expect(dm.locator('[data-message]')).toHaveCount(1);
  await dm.getByRole('textbox', { name: 'Reply' }).click();
  await dm.getByRole('button', { name: 'B', exact: true }).click();
  await dm.keyboard.type('Yes');
  await dm.getByRole('button', { name: 'B', exact: true }).click();
  await dm.keyboard.type(', if you find a teacher.');
  await dm.getByRole('button', { name: 'Send reply' }).click();
  await expect(dm.locator('[data-message]')).toHaveCount(2);
  await expect(dm.locator('[data-message][data-from="dm"] strong')).toHaveText('Yes');
  await expect(dm.getByRole('textbox', { name: 'Reply' })).toHaveText(''); // the box is empty again
  await expect(count(dm)).toHaveCount(0);
  await expect(row(dm, 'A new spell').locator('[data-request-state]')).toHaveText('Waiting for the player');
  await dm.screenshot({ path: path.join(shots, 'u4-thread-dm.png'), fullPage: true });

  // ---- Elara sees the answer waiting, and writes back ----
  await elara.reload();
  await expect(count(elara)).toHaveText('1');
  await expect(elara.locator('[data-message]')).toHaveCount(2);
  await expect(elara.locator('[data-message][data-from="dm"]')).toContainText('Yes, if you find a teacher.');
  await elara.screenshot({ path: path.join(shots, 'u4-thread-player-phone.png'), fullPage: true });
  await elara.getByRole('textbox', { name: 'Reply' }).click();
  await elara.keyboard.type('Thank you!');
  await elara.getByRole('button', { name: 'Send reply' }).click();
  await expect(elara.locator('[data-message]')).toHaveCount(3);
  await expect(count(elara)).toHaveCount(0);
  // The icons of the navigation still fit on one line of the phone.
  const tops = await elara.locator('header.bar nav a').evaluateAll((els) => els.map((el) => Math.round(el.getBoundingClientRect().top)));
  expect(new Set(tops).size).toBe(1);

  // ---- The DM resolves it: it moves to the Archive on both sides, and nobody writes in it ----
  await dm.reload();
  await expect(count(dm)).toHaveText('1');
  await expect(dm.locator('[data-message]')).toHaveCount(3);
  await dm.getByRole('button', { name: 'Mark resolved' }).click();
  await expect(dm.locator('[data-request-status]')).toContainText('Resolved');
  await expect(dm.locator('[data-folder="open"]')).toHaveText(/Open\s*0/);
  await expect(dm.locator('[data-folder="archive"]')).toHaveText(/Archive\s*1/);
  await expect(dm.locator('[data-folder="archive"]')).toHaveAttribute('aria-selected', 'true');
  await expect(row(dm, 'A new spell')).toBeVisible();
  await expect(count(dm)).toHaveCount(0);
  await expect(dm.getByRole('textbox', { name: 'Reply' })).toHaveCount(0);

  await elara.reload();
  await expect(elara.locator('[data-request-closed]')).toContainText('Only the DM can reopen it');
  await expect(elara.getByRole('textbox', { name: 'Reply' })).toHaveCount(0);
  await elara.getByRole('link', { name: '← Requests' }).click();
  // The list opens on the folder the request lies in.
  await expect(elara.locator('[data-folder="archive"]')).toHaveAttribute('aria-selected', 'true');
  await expect(row(elara, 'A new spell').locator('[data-request-state]')).toHaveText('Resolved');
  await elara.locator('[data-folder="open"]').click();
  await expect(elara.locator('[data-requests] [data-empty]')).toContainText('No open requests.');
  const requestUrl = dm.url();

  // ---- Brann, another player, has no requests and cannot open Elara's by its address ----
  const brannContext = await browser.newContext();
  const brann = await brannContext.newPage();
  await login(brann, 'brann', 'brann-password');
  await brann.getByRole('link', { name: 'Requests' }).click();
  await expect(brann.locator('[data-folder="open"]')).toHaveText(/Open\s*0/);
  await expect(brann.locator('[data-folder="archive"]')).toHaveText(/Archive\s*0/);
  await brann.goto(requestUrl);
  await expect(brann.getByText('This request does not exist, or it was deleted.')).toBeVisible();
  expect(await brann.content()).not.toContain('Fireball');

  // ---- The DM writes to Brann first; it waits for Brann ----
  await dm.getByRole('link', { name: 'New request' }).click();
  await dm.getByLabel('To player').selectOption({ label: 'Brann' });
  await dm.getByLabel('Subject').fill('Your backstory');
  await dm.getByRole('textbox', { name: 'Message' }).click();
  await dm.keyboard.type('Who was your mentor?');
  await dm.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(dm.locator('[data-request-subject]')).toHaveText('Your backstory');
  await expect(row(dm, 'Your backstory')).toContainText('Brann');
  await expect(count(dm)).toHaveCount(0);

  await brann.getByRole('link', { name: 'Requests' }).click();
  await brann.reload();
  await expect(count(brann)).toHaveText('1');
  await expect(row(brann, 'Your backstory').locator('[data-request-state]')).toHaveText('Waiting for you');
  await elara.reload();
  await elara.locator('[data-folder="open"]').click();
  await expect(row(elara, 'Your backstory')).toHaveCount(0); // not hers

  // ---- The DM reopens Elara's request, then deletes it: gone for both ----
  await dm.locator('[data-folder="archive"]').click();
  await row(dm, 'A new spell').getByRole('link').click();
  await dm.getByRole('button', { name: 'Reopen' }).click();
  await expect(dm.locator('[data-request-status]')).toContainText('Open');
  await expect(dm.getByRole('textbox', { name: 'Reply' })).toBeVisible();
  await expect(dm.locator('[data-folder="open"]')).toHaveText(/Open\s*2/);
  await dm.screenshot({ path: path.join(shots, 'u4-list-dm.png'), fullPage: true });
  await dm.getByRole('button', { name: 'Delete' }).click();
  await expect(row(dm, 'A new spell')).toHaveCount(0);
  await expect(dm.locator('[data-folder="open"]')).toHaveText(/Open\s*1/);
  await elara.reload();
  await expect(elara.locator('[data-folder="open"]')).toHaveText(/Open\s*0/);
  await expect(elara.locator('[data-folder="archive"]')).toHaveText(/Archive\s*0/);

  for (const c of [elaraContext, dmContext, brannContext]) await c.close();
});
