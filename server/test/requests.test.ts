import { describe, expect, it } from 'vitest';
import { requestMessages, requests } from '../src/db/schema';
import { client, code, world } from './helpers';

// Player Requests (task U4a, PLAN.md 10.4): who receives a request, who may write, resolve and delete,
// the count in the navigation, and the export and import.

async function setup() {
  const w = await world(['alice', 'bob']);
  const alice = w.players.alice!;
  const bob = w.players.bob!;
  const { id } = await alice.request.create({ systemId: w.systemId, subject: 'A new spell', body: '<p>May I learn <strong>Fireball</strong>?</p>' });
  const waiting = async (c: typeof alice) => (await c.request.waiting({ systemId: w.systemId })).count;
  return { ...w, alice, bob, id, waiting };
}

describe('who receives a request', () => {
  it('goes to its player and the DM, and to no other player', async () => {
    const { dm, alice, bob, systemId, id } = await setup();
    expect((await alice.request.list({ systemId })).map((r) => r.id)).toEqual([id]);
    expect((await dm.request.list({ systemId })).map((r) => r.id)).toEqual([id]);
    expect(await bob.request.list({ systemId })).toEqual([]);

    const forDm = await dm.request.get({ id });
    expect(forDm.playerName).toBe('alice');
    expect(forDm.messages.map((m) => [m.from, m.authorName])).toEqual([['player', 'alice']]);
    expect((await alice.request.get({ id })).canManage).toBe(false);
    expect(forDm.canManage).toBe(true);
  });

  it('answers another player exactly like a request that does not exist', async () => {
    const { bob, id } = await setup();
    expect(await code(bob.request.get({ id }))).toBe('NOT_FOUND');
    expect(await code(bob.request.get({ id: 'no-such-request' }))).toBe('NOT_FOUND');
    expect(await code(bob.request.reply({ id, body: '<p>Me too</p>' }))).toBe('NOT_FOUND');
    expect(await code(bob.request.resolve({ id }))).toBe('NOT_FOUND');
    expect(await code(bob.request.reopen({ id }))).toBe('NOT_FOUND');
    expect(await code(bob.request.remove({ id }))).toBe('NOT_FOUND');
  });

  it('is closed to someone outside the System and to someone not logged in', async () => {
    const { db, id, systemId } = await setup();
    const other = await world([]); // another server's DM would be another database; here: nobody logged in
    void other;
    const nobody = client(db);
    expect(await code(nobody.request.get({ id }))).toBe('UNAUTHORIZED');
    expect(await code(nobody.request.list({ systemId }))).toBe('UNAUTHORIZED');
    expect(await code(nobody.request.waiting({ systemId }))).toBe('UNAUTHORIZED');
  });

  it('stays inside its System: the DM of another System does not receive it', async () => {
    const { db, dm, id, systemId } = await setup();
    // Bob is made the DM of a second System through a DM invite there.
    const { systemId: second } = await dm.system.create({ name: 'Second' });
    const { token } = await dm.system.createInvite({ systemId: second, role: 'dm' });
    const carol = client(db);
    await carol.auth.acceptInvite({ token, username: 'carol', displayName: 'Carol', password: 'carol-password' });
    expect(await carol.request.list({ systemId: second })).toEqual([]);
    expect(await code(carol.request.get({ id }))).toBe('NOT_FOUND');
    expect(await code(carol.request.list({ systemId }))).toBe('NOT_FOUND');
    expect(await code(carol.request.remove({ id }))).toBe('NOT_FOUND');
  });
});

describe('the thread', () => {
  it('both sides write while it is open, and the count follows the last message', async () => {
    const { dm, alice, bob, id, waiting } = await setup();
    expect(await waiting(dm)).toBe(1);
    expect(await waiting(alice)).toBe(0);
    expect(await waiting(bob)).toBe(0);

    await dm.request.reply({ id, body: '<p>Which circle?</p>' });
    expect(await waiting(dm)).toBe(0);
    expect(await waiting(alice)).toBe(1);

    await alice.request.reply({ id, body: '<p>Third.</p>' });
    await alice.request.reply({ id, body: '<p>Or fourth.</p>' });
    expect(await waiting(dm)).toBe(1);
    expect(await waiting(alice)).toBe(0);
    expect((await dm.request.get({ id })).messages.map((m) => m.from)).toEqual(['player', 'dm', 'player', 'player']);
  });

  it('cleans message text on the server and refuses an empty message', async () => {
    const { dm, alice, systemId, id } = await setup();
    await alice.request.reply({ id, body: '<p onclick="x()">Hello<script>alert(1)</script> <img src="x" onerror="y()"><strong>there</strong></p>' });
    const last = (await dm.request.get({ id })).messages.at(-1)!;
    expect(last.body).toBe('<p>Hello <strong>there</strong></p>');

    expect(await code(alice.request.reply({ id, body: '<p> </p>' }))).toBe('BAD_REQUEST');
    expect(await code(alice.request.reply({ id, body: '<script>alert(1)</script>' }))).toBe('BAD_REQUEST');
    expect(await code(alice.request.create({ systemId, subject: 'Empty', body: '' }))).toBe('BAD_REQUEST');
    expect(await code(alice.request.create({ systemId, subject: '   ', body: '<p>Text</p>' }))).toBe('BAD_REQUEST');
    expect(await alice.request.list({ systemId })).toHaveLength(1);
  });

  it('only the DM resolves and reopens; nobody writes in a resolved request', async () => {
    const { dm, alice, systemId, id, waiting } = await setup();
    expect(await code(alice.request.resolve({ id }))).toBe('FORBIDDEN');
    await dm.request.resolve({ id });
    expect((await alice.request.list({ systemId }))[0]!.status).toBe('resolved');
    expect(await waiting(dm)).toBe(0); // a resolved request waits for nobody
    expect(await code(alice.request.reply({ id, body: '<p>One more thing</p>' }))).toBe('CONFLICT');
    expect(await code(dm.request.reply({ id, body: '<p>Late answer</p>' }))).toBe('CONFLICT');
    expect((await alice.request.get({ id })).canReply).toBe(false);

    expect(await code(alice.request.reopen({ id }))).toBe('FORBIDDEN');
    await dm.request.reopen({ id });
    expect((await alice.request.get({ id })).status).toBe('open');
    await alice.request.reply({ id, body: '<p>One more thing</p>' });
    expect(await waiting(dm)).toBe(1);
  });

  it('only the DM deletes a request; it is then gone for both sides', async () => {
    const { db, dm, alice, systemId, id } = await setup();
    expect(await code(alice.request.remove({ id }))).toBe('FORBIDDEN');
    expect(await alice.request.list({ systemId })).toHaveLength(1);
    await dm.request.remove({ id });
    expect(await alice.request.list({ systemId })).toEqual([]);
    expect(await dm.request.list({ systemId })).toEqual([]);
    expect(await code(alice.request.get({ id }))).toBe('NOT_FOUND');
    expect(db.select().from(requests).all()).toEqual([]);
    expect(db.select().from(requestMessages).all()).toEqual([]);
  });
});

describe('a thread started by the DM', () => {
  it('is addressed to one player, lies in their list and waits for them', async () => {
    const { dm, alice, bob, systemId, waiting } = await setup();
    const { id } = await dm.request.create({ systemId, subject: 'Your backstory', body: '<p>Who was your mentor?</p>', playerId: bob.userId() });
    expect((await bob.request.list({ systemId })).map((r) => [r.id, r.waiting, r.lastFrom])).toEqual([[id, true, 'dm']]);
    expect(await waiting(bob)).toBe(1);
    expect((await alice.request.list({ systemId })).map((r) => r.id)).not.toContain(id);
    expect(await code(alice.request.get({ id }))).toBe('NOT_FOUND');

    await bob.request.reply({ id, body: '<p>An old wizard.</p>' });
    expect(await waiting(bob)).toBe(0);
    expect(await waiting(dm)).toBe(2); // Alice's request and Bob's answer
  });

  it('needs a player of this System; a player cannot write in another player\'s name', async () => {
    const { dm, alice, bob, systemId } = await setup();
    const text = { subject: 'Hello', body: '<p>Text</p>' };
    expect(await code(dm.request.create({ systemId, ...text }))).toBe('BAD_REQUEST');
    expect(await code(dm.request.create({ systemId, ...text, playerId: dm.userId() }))).toBe('NOT_FOUND');
    expect(await code(dm.request.create({ systemId, ...text, playerId: 'no-such-user' }))).toBe('NOT_FOUND');
    expect(await code(alice.request.create({ systemId, ...text, playerId: bob.userId() }))).toBe('FORBIDDEN');
    expect(await bob.request.list({ systemId })).toEqual([]);
  });
});

describe('a player removed from the System', () => {
  it('loses the requests; the DM keeps them as "former member", and they no longer wait', async () => {
    const { dm, alice, systemId, id, waiting } = await setup();
    expect(await waiting(dm)).toBe(1);
    await dm.system.removeMember({ systemId, userId: alice.userId() });

    expect(await code(alice.request.list({ systemId }))).toBe('NOT_FOUND');
    expect(await code(alice.request.get({ id }))).toBe('NOT_FOUND');
    expect(await code(alice.request.reply({ id, body: '<p>Still here</p>' }))).toBe('NOT_FOUND');

    const [row] = await dm.request.list({ systemId });
    expect([row!.id, row!.playerName, row!.playerFormer, row!.waiting]).toEqual([id, 'alice', true, false]);
    expect(await waiting(dm)).toBe(0);
    expect((await dm.request.get({ id })).playerFormer).toBe(true);
  });

  it('sees them again when added back', async () => {
    const { dm, alice, systemId, id, waiting } = await setup();
    await dm.system.removeMember({ systemId, userId: alice.userId() });
    const { token } = await dm.system.createInvite({ systemId, role: 'player' });
    await alice.auth.joinWithInvite({ token });
    expect((await alice.request.list({ systemId })).map((r) => r.id)).toEqual([id]);
    expect(await waiting(dm)).toBe(1);
  });
});

describe('export and import', () => {
  it('carries requests and their messages into the new System under new ids', async () => {
    const { db, dm, alice, bob, systemId, id } = await setup();
    await dm.request.reply({ id, body: '<p>Yes.</p>' });
    await dm.request.resolve({ id });
    await dm.request.create({ systemId, subject: 'For Bob', body: '<p>Hello Bob</p>', playerId: bob.userId() });

    const data = await dm.system.export({ systemId });
    expect(data.requests).toHaveLength(2);
    const { systemId: copy } = await dm.system.import({ data });

    const copied = await dm.request.list({ systemId: copy });
    expect(copied.map((r) => [r.subject, r.status, r.playerName]).sort()).toEqual([['A new spell', 'resolved', 'alice'], ['For Bob', 'open', 'bob']]);
    expect(copied.map((r) => r.id)).not.toContain(id);
    const mine = await alice.request.list({ systemId: copy });
    expect(mine.map((r) => r.subject)).toEqual(['A new spell']);
    expect((await alice.request.get({ id: mine[0]!.id })).messages.map((m) => [m.from, m.body])).toEqual([
      ['player', '<p>May I learn <strong>Fireball</strong>?</p>'],
      ['dm', '<p>Yes.</p>'],
    ]);
    // The original is untouched.
    expect(await dm.request.list({ systemId })).toHaveLength(2);
    expect(db.select().from(requests).all()).toHaveLength(4);
  });

  it('leaves out a request whose player has no account here, and cleans message text', async () => {
    const { dm, systemId } = await setup();
    const data = await dm.system.export({ systemId });
    const [first] = data.requests;
    const edited = {
      ...data,
      requests: [
        { ...first!, messages: [{ ...first!.messages[0]!, body: '<p>Hi<script>alert(1)</script></p>' }] },
        { ...first!, id: 'stranger-request', playerId: 'someone-unknown', messages: [{ ...first!.messages[0]!, id: 'stranger-message' }] },
      ],
    };
    const { systemId: copy } = await dm.system.import({ data: edited });
    const copied = await dm.request.list({ systemId: copy });
    expect(copied).toHaveLength(1);
    expect((await dm.request.get({ id: copied[0]!.id })).messages[0]!.body).toBe('<p>Hi</p>');
  });

  it('still imports a file made before requests existed', async () => {
    const { dm, systemId } = await setup();
    const { requests: _gone, ...old } = await dm.system.export({ systemId });
    const { systemId: copy } = await dm.system.import({ data: old });
    expect(await dm.request.list({ systemId: copy })).toEqual([]);
  });
});
