import { describe, expect, it } from 'vitest';
import { client, code, world } from './helpers';

describe('accounts and invites', () => {
  it('allows first-run setup only once', async () => {
    const { db } = await world([]);
    const second = client(db);
    expect((await second.auth.status()).needsSetup).toBe(false);
    expect(
      await code(second.auth.setup({ username: 'evil', displayName: 'Evil', password: 'evil-password', systemName: 'x' })),
    ).toBe('FORBIDDEN');
  });

  it('uses an invite link once and rejects a wrong password', async () => {
    const { db, dm, systemId } = await world([]);
    const { token } = await dm.system.createInvite({ systemId, role: 'player' });
    const alice = client(db);
    expect((await alice.auth.inviteInfo({ token })).valid).toBe(true);
    await alice.auth.acceptInvite({ token, username: 'Alice', displayName: 'Alice', password: 'alice-password' });
    expect((await alice.system.get({ systemId })).role).toBe('player');

    const bob = client(db);
    expect((await bob.auth.inviteInfo({ token })).valid).toBe(false);
    expect(await code(bob.auth.acceptInvite({ token, username: 'bob', displayName: 'Bob', password: 'bob-password' }))).toBe('NOT_FOUND');

    const again = client(db);
    expect(await code(again.auth.login({ username: 'alice', password: 'wrong-password' }))).toBe('UNAUTHORIZED');
    expect(await code(again.auth.login({ username: 'ALICE', password: 'alice-password' }))).toBe('OK');
  });

  it('lets the DM reset a player password, which ends the old sessions', async () => {
    const { db, dm, systemId, players } = await world(['alice']);
    const alice = players.alice!;
    await dm.system.resetPassword({ systemId, userId: alice.userId(), newPassword: 'brand-new-password' });
    expect(await code(alice.system.list())).toBe('UNAUTHORIZED');
    const fresh = client(db);
    expect(await code(fresh.auth.login({ username: 'alice', password: 'alice-password' }))).toBe('UNAUTHORIZED');
    expect(await code(fresh.auth.login({ username: 'alice', password: 'brand-new-password' }))).toBe('OK');
  });
});

describe('change log', () => {
  it('records each edit and reverts one', async () => {
    const { dm, systemId, players } = await world(['alice']);
    const alice = players.alice!;
    const note = await alice.entity.create({ systemId, typeKey: 'note', name: 'Log' });
    await alice.entity.setField({ id: note.id, fieldId: 'summary', value: 'first' });
    await alice.entity.setField({ id: note.id, fieldId: 'summary', value: 'second' });
    await alice.entity.setField({ id: note.id, fieldId: 'summary', value: 'second' }); // no change, no entry
    await alice.entity.rename({ id: note.id, name: 'Log renamed' });

    let history = await dm.entity.history({ id: note.id });
    expect(history.map((h) => h.target)).toEqual(['name', 'field', 'field', 'create']);
    expect(history[1]).toMatchObject({ oldValue: 'first', newValue: 'second', userName: 'alice', label: 'Summary' });

    await dm.entity.revert({ changeId: history[1]!.id });
    expect((await alice.entity.get({ id: note.id })).values.summary).toBe('first');
    await dm.entity.revert({ changeId: history[0]!.id });
    expect((await alice.entity.get({ id: note.id })).name).toBe('Log');

    history = await dm.entity.history({ id: note.id });
    expect(history).toHaveLength(6);
    expect(history[0]!.userName).toBe('The DM');
  });

  it('soft-deletes and restores', async () => {
    const { dm, systemId } = await world([]);
    const note = await dm.entity.create({ systemId, typeKey: 'note', name: 'Gone' });
    await dm.entity.delete({ id: note.id });
    expect(await code(dm.entity.get({ id: note.id }))).toBe('NOT_FOUND');
    expect((await dm.entity.listDeleted({ systemId })).map((e) => e.id)).toEqual([note.id]);
    await dm.entity.restore({ id: note.id });
    expect((await dm.entity.get({ id: note.id })).name).toBe('Gone');
  });
});

describe('export and import', () => {
  it('round-trips a system into a new one with the same content', async () => {
    const { dm, systemId, players } = await world(['alice']);
    const alice = players.alice!;
    const { id: campaignId } = await dm.system.createCampaign({ systemId, name: 'Campaign A' });
    await dm.system.updateCampaign({ systemId, campaignId, memberIds: [alice.userId()] });
    const { id: partyId } = await dm.system.createParty({ systemId, campaignId, name: 'Party A' });
    await dm.system.updateParty({ systemId, partyId, memberIds: [alice.userId()] });
    const a = await dm.entity.create({ systemId, typeKey: 'note', name: 'A', campaignIds: [campaignId] });
    const b = await alice.entity.create({ systemId, typeKey: 'note', name: 'B' });
    await dm.entity.setField({ id: a.id, fieldId: 'body', value: 'text of A' });
    await dm.entity.setField({ id: a.id, fieldId: 'session', value: 7 });
    await dm.entity.setVisibility({ id: a.id, audience: { all: false, players: [], parties: [partyId] } });
    await dm.entity.link({ fromId: a.id, kind: 'mentions', toId: b.id, data: { note: 'hi' } });

    const exported = await dm.system.export({ systemId });
    const { systemId: copyId } = await dm.system.import({ data: JSON.parse(JSON.stringify(exported)) });
    expect(copyId).not.toBe(systemId);
    const copy = await dm.system.export({ systemId: copyId });

    expect(copy.system.name).toBe('Test System (imported)');
    expect(copy.entities.map((e) => e.name).sort()).toEqual(['A', 'B']);
    expect(copy.changes).toHaveLength(exported.changes.length);
    expect(copy.members).toHaveLength(2);

    // No id of the original system survives, and references still point at each other.
    const originalIds = [systemId, campaignId, partyId, a.id, b.id, exported.links[0]!.id];
    for (const id of originalIds) expect(JSON.stringify(copy)).not.toContain(id);
    const copyA = copy.entities.find((e) => e.name === 'A')!;
    const copyB = copy.entities.find((e) => e.name === 'B')!;
    expect(copyA.values).toEqual({ body: 'text of A', session: 7 });
    expect(copyA.visibility.parties).toEqual([copy.parties[0]!.id]);
    expect(copyA.campaignIds).toEqual([copy.campaigns[0]!.id]);
    expect(copy.parties[0]!.campaignId).toBe(copy.campaigns[0]!.id);
    expect(copy.campaigns[0]!.memberIds).toEqual([alice.userId()]);
    expect(copy.links[0]).toMatchObject({ fromId: copyA.id, toId: copyB.id, data: { note: 'hi' } });
    expect(copyB.ownerId).toBe(alice.userId());

    // The player sees the copy exactly as they saw the original: through the party.
    expect((await alice.entity.list({ systemId: copyId })).map((e) => e.name).sort()).toEqual(['A', 'B']);
  });

  it('rejects a file that is not an export', async () => {
    const { dm } = await world([]);
    expect(await code(dm.system.import({ data: { hello: 'world' } }))).toBe('BAD_REQUEST');
  });
});
