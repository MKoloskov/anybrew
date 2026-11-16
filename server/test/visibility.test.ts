import { describe, expect, it } from 'vitest';
import { client, code, world, type Client } from './helpers';

const SECRET = 'SECRET-';

/** Everything a member can read through the API, as one string. */
async function everythingVisibleTo(c: Client, systemId: string): Promise<string> {
  const parts: unknown[] = [];
  parts.push(await c.auth.status());
  parts.push(await c.system.list());
  parts.push(await c.system.get({ systemId }));
  parts.push(await c.entity.types({ systemId }));
  const list = await c.entity.list({ systemId });
  parts.push(list);
  for (const e of list) {
    parts.push(await c.entity.get({ id: e.id }));
    parts.push(await c.entity.links({ id: e.id }));
  }
  return JSON.stringify(parts);
}

describe('visibility: a player never receives hidden data', () => {
  it('hides DM-only entities, groups, fields, overrides and links', async () => {
    const { dm, systemId, players } = await world(['alice', 'bob']);
    const alice = players.alice!;
    const bob = players.bob!;

    const { id: campaignId } = await dm.system.createCampaign({ systemId, name: 'Campaign A' });
    await dm.system.updateCampaign({ systemId, campaignId, memberIds: [alice.userId(), bob.userId()] });
    const { id: partyId } = await dm.system.createParty({ systemId, campaignId, name: 'Party A' });
    await dm.system.updateParty({ systemId, partyId, memberIds: [alice.userId()] });

    // 1. Entirely DM-only.
    const hidden = await dm.entity.create({ systemId, typeKey: 'note', name: `${SECRET}hidden-entity` });
    await dm.entity.setField({ id: hidden.id, fieldId: 'summary', value: `${SECRET}hidden-summary` });

    // 2. Visible to everyone, with a DM-only group and one field hidden by an override.
    const open = await dm.entity.create({ systemId, typeKey: 'note', name: 'Open note' });
    await dm.entity.setVisibility({ id: open.id, audience: { all: true, players: [], parties: [] } });
    await dm.entity.setField({ id: open.id, fieldId: 'summary', value: 'public summary' });
    await dm.entity.setField({ id: open.id, fieldId: 'dm_notes', value: `${SECRET}dm-group` });
    await dm.entity.setField({ id: open.id, fieldId: 'body', value: `${SECRET}override-field` });
    await dm.entity.setFieldVisibility({ id: open.id, nodeId: 'body', audience: { all: false, players: [], parties: [] } });

    // 3. Visible to Party A only (Alice is in it, Bob is not).
    const party = await dm.entity.create({ systemId, typeKey: 'note', name: 'PARTYONLY-note' });
    await dm.entity.setVisibility({ id: party.id, audience: { all: false, players: [], parties: [partyId] } });

    // 4. Visible to Bob only.
    const forBob = await dm.entity.create({ systemId, typeKey: 'note', name: 'BOBONLY-note' });
    await dm.entity.setVisibility({ id: forBob.id, audience: { all: false, players: [bob.userId()], parties: [] } });

    // 5. A link from the open note to the hidden one.
    await dm.entity.link({ fromId: open.id, kind: 'mentions', toId: hidden.id });

    const aliceSees = await everythingVisibleTo(alice, systemId);
    const bobSees = await everythingVisibleTo(bob, systemId);

    for (const seen of [aliceSees, bobSees]) {
      expect(seen).not.toContain(SECRET);
      expect(seen).not.toContain('DM notes'); // the hidden group's label
      expect(seen).not.toContain(hidden.id);
      expect(seen).toContain('public summary');
    }
    expect(aliceSees).toContain('PARTYONLY');
    expect(bobSees).not.toContain('PARTYONLY');
    expect(bobSees).toContain('BOBONLY');
    expect(aliceSees).not.toContain('BOBONLY');

    // Players are not told who else can see things.
    const openForAlice = await alice.entity.get({ id: open.id });
    expect(openForAlice.access).toBeNull();
    expect(JSON.stringify(openForAlice.schema)).not.toContain('visibility');

    // The DM still sees all of it.
    expect(await everythingVisibleTo(dm, systemId)).toContain(`${SECRET}dm-group`);

    // Direct access by id answers like a missing entity.
    expect(await code(alice.entity.get({ id: hidden.id }))).toBe('NOT_FOUND');
    expect(await code(alice.entity.links({ id: hidden.id }))).toBe('NOT_FOUND');
    expect(await code(alice.entity.rename({ id: hidden.id, name: 'x' }))).toBe('NOT_FOUND');
    expect(await code(alice.entity.setField({ id: hidden.id, fieldId: 'summary', value: 'x' }))).toBe('NOT_FOUND');
    expect(await code(alice.entity.link({ fromId: open.id, kind: 'k', toId: hidden.id }))).toBe('FORBIDDEN');
  });

  it('keeps DM-only endpoints closed to players', async () => {
    const { dm, systemId, players } = await world(['alice']);
    const alice = players.alice!;
    const note = await dm.entity.create({ systemId, typeKey: 'note', name: 'n' });
    await dm.entity.setVisibility({ id: note.id, audience: { all: true, players: [], parties: [] } });
    await dm.entity.setField({ id: note.id, fieldId: 'dm_notes', value: `${SECRET}x` });
    const history = await dm.entity.history({ id: note.id });

    expect(await code(alice.entity.history({ id: note.id }))).toBe('FORBIDDEN');
    expect(await code(alice.entity.revert({ changeId: history[0]!.id }))).toBe('FORBIDDEN');
    expect(await code(alice.entity.setVisibility({ id: note.id, audience: { all: true, players: [], parties: [] } }))).toBe('FORBIDDEN');
    expect(await code(alice.entity.setFieldVisibility({ id: note.id, nodeId: 'dm', audience: null }))).toBe('FORBIDDEN');
    expect(await code(alice.entity.setOwner({ id: note.id, ownerId: alice.userId() }))).toBe('FORBIDDEN');
    expect(await code(alice.entity.listDeleted({ systemId }))).toBe('FORBIDDEN');
    expect(await code(alice.system.export({ systemId }))).toBe('FORBIDDEN');
    expect(await code(alice.system.listInvites({ systemId }))).toBe('FORBIDDEN');
    expect(await code(alice.system.createInvite({ systemId, role: 'dm' }))).toBe('FORBIDDEN');
    expect(await code(alice.system.createParty({ systemId, campaignId: 'x', name: 'p' }))).toBe('FORBIDDEN');
    expect(await code(alice.system.createCampaign({ systemId, name: 'c' }))).toBe('FORBIDDEN');
    expect(await code(alice.system.updateCampaign({ systemId, campaignId: 'x', memberIds: [] }))).toBe('FORBIDDEN');
    expect(await code(alice.system.deleteCampaign({ systemId, campaignId: 'x' }))).toBe('FORBIDDEN');
    expect(await code(alice.entity.setCampaigns({ id: note.id, campaignIds: [] }))).toBe('FORBIDDEN');
    expect(await code(alice.system.create({ name: 'My own system' }))).toBe('FORBIDDEN');
    expect(await code(alice.system.rename({ systemId, name: 'p' }))).toBe('FORBIDDEN');
    expect(await code(alice.system.resetPassword({ systemId, userId: dm.userId(), newPassword: 'new-password' }))).toBe('FORBIDDEN');
    // Login names of other members are for the DM only.
    expect(JSON.stringify(await alice.system.get({ systemId }))).not.toContain('username');
  });

  it('lets an owner see and edit their entity, but not DM groups or DM-edit-only fields', async () => {
    const { dm, systemId, players } = await world(['alice', 'bob']);
    const alice = players.alice!;
    const bob = players.bob!;
    const mine = await alice.entity.create({ systemId, typeKey: 'note', name: 'Alice note' });
    await dm.entity.setField({ id: mine.id, fieldId: 'dm_notes', value: `${SECRET}about-alice` });
    await dm.entity.setField({ id: mine.id, fieldId: 'verdict', value: 'approved' });

    const dto = await alice.entity.get({ id: mine.id });
    expect(JSON.stringify(dto)).not.toContain(SECRET);
    expect(dto.values.verdict).toBe('approved');
    expect(dto.editableFields).toContain('summary');
    expect(dto.editableFields).not.toContain('verdict');

    expect(await code(alice.entity.setField({ id: mine.id, fieldId: 'summary', value: 'hello' }))).toBe('OK');
    expect(await code(alice.entity.setField({ id: mine.id, fieldId: 'verdict', value: 'x' }))).toBe('FORBIDDEN');
    expect(await code(alice.entity.setField({ id: mine.id, fieldId: 'dm_notes', value: 'x' }))).toBe('FORBIDDEN');
    expect(await code(alice.entity.setField({ id: mine.id, fieldId: 'no_such_field', value: 'x' }))).toBe('FORBIDDEN');
    expect(await code(alice.entity.setField({ id: mine.id, fieldId: 'session', value: 'not a number' }))).toBe('BAD_REQUEST');

    // Another player neither sees nor edits it.
    expect(await code(bob.entity.get({ id: mine.id }))).toBe('NOT_FOUND');
    expect(JSON.stringify(await bob.entity.list({ systemId }))).not.toContain('Alice note');
  });

  it('gives nothing to a logged-out visitor or to a member of another system', async () => {
    const { db, dm, systemId } = await world([]);
    const note = await dm.entity.create({ systemId, typeKey: 'note', name: 'n' });
    await dm.entity.setVisibility({ id: note.id, audience: { all: true, players: [], parties: [] } });

    const anonymous = client(db);
    expect(await code(anonymous.system.get({ systemId }))).toBe('UNAUTHORIZED');
    expect(await code(anonymous.entity.get({ id: note.id }))).toBe('UNAUTHORIZED');
    expect(await code(anonymous.entity.list({ systemId }))).toBe('UNAUTHORIZED');

    // An outsider: a real account that belongs to a different system.
    const other = await dm.system.import({ data: await dm.system.export({ systemId }) });
    const { token } = await dm.system.createInvite({ systemId: other.systemId, role: 'player' });
    const outsider = client(db);
    await outsider.auth.acceptInvite({ token, username: 'eve', displayName: 'Eve', password: 'eve-password' });
    expect(await code(outsider.system.get({ systemId }))).toBe('NOT_FOUND');
    expect(await code(outsider.entity.list({ systemId }))).toBe('NOT_FOUND');
    expect(await code(outsider.entity.get({ id: note.id }))).toBe('NOT_FOUND');
    expect(await code(outsider.entity.create({ systemId, typeKey: 'note', name: 'x' }))).toBe('NOT_FOUND');
  });
});

describe('campaigns: a filter inside a system, closed to players of other campaigns', () => {
  const ALL = { all: true, players: [], parties: [] };

  async function twoCampaigns() {
    const w = await world(['alice', 'bob']);
    const alice = w.players.alice!;
    const bob = w.players.bob!;
    const a = (await w.dm.system.createCampaign({ systemId: w.systemId, name: 'CAMPAIGN-ALPHA' })).id;
    const b = (await w.dm.system.createCampaign({ systemId: w.systemId, name: 'CAMPAIGN-BETA' })).id;
    await w.dm.system.updateCampaign({ systemId: w.systemId, campaignId: a, memberIds: [alice.userId()] });
    await w.dm.system.updateCampaign({ systemId: w.systemId, campaignId: b, memberIds: [bob.userId()] });
    return { ...w, alice, bob, a, b };
  }

  it('hides campaign content, campaign names and campaign players from outsiders', async () => {
    const { dm, systemId, alice, bob, a } = await twoCampaigns();

    // Campaign-agnostic rule content, open to all players of the system.
    const spell = await dm.entity.create({ systemId, typeKey: 'note', name: 'SHARED-spell' });
    await dm.entity.setVisibility({ id: spell.id, audience: ALL });

    // Campaign content open to "all players": that means all players of Alpha.
    const story = await dm.entity.create({ systemId, typeKey: 'note', name: 'ALPHA-story', campaignIds: [a] });
    await dm.entity.setVisibility({ id: story.id, audience: ALL });

    // Naming Bob in the audience does not let him through the campaign wall either.
    const named = await dm.entity.create({ systemId, typeKey: 'note', name: 'ALPHA-named', campaignIds: [a] });
    await dm.entity.setVisibility({ id: named.id, audience: { all: false, players: [bob.userId()], parties: [] } });

    const aliceSees = await everythingVisibleTo(alice, systemId);
    const bobSees = await everythingVisibleTo(bob, systemId);

    expect(aliceSees).toContain('SHARED-spell');
    expect(bobSees).toContain('SHARED-spell');
    expect(aliceSees).toContain('ALPHA-story');
    expect(bobSees).not.toContain('ALPHA-');
    expect(await code(bob.entity.get({ id: story.id }))).toBe('NOT_FOUND');
    expect(await code(bob.entity.get({ id: named.id }))).toBe('NOT_FOUND');

    // Bob does not learn that Alpha exists, its id, or who plays in it.
    expect(bobSees).not.toContain('CAMPAIGN-ALPHA');
    expect(bobSees).not.toContain(a);
    expect(bobSees).not.toContain(alice.userId());
    expect(bobSees).toContain('CAMPAIGN-BETA');

    // The DM sees every campaign at once, with no switching.
    const dmList = (await dm.entity.list({ systemId })).map((e) => e.name);
    expect(dmList).toEqual(expect.arrayContaining(['SHARED-spell', 'ALPHA-story', 'ALPHA-named']));

    // Moving the story out of the campaign opens it to Bob; moving it back closes it.
    await dm.entity.setCampaigns({ id: story.id, campaignIds: [] });
    expect(await code(bob.entity.get({ id: story.id }))).toBe('OK');
    await dm.entity.setCampaigns({ id: story.id, campaignIds: [a] });
    expect(await code(bob.entity.get({ id: story.id }))).toBe('NOT_FOUND');
  });

  it('keeps parties inside their campaign and players inside their own campaigns', async () => {
    const { db, dm, systemId, alice, bob, a, b } = await twoCampaigns();

    const { id: partyId } = await dm.system.createParty({ systemId, campaignId: a, name: 'Alpha party' });
    await dm.system.updateParty({ systemId, partyId, memberIds: [alice.userId(), bob.userId()] });
    const party = (await dm.system.get({ systemId })).parties.find((p) => p.id === partyId)!;
    expect(party.memberIds).toEqual([alice.userId()]);

    // A player files their own things under their own campaign only.
    expect(await code(alice.entity.create({ systemId, typeKey: 'note', name: 'x', campaignIds: [b] }))).toBe('NOT_FOUND');
    const mine = await alice.entity.create({ systemId, typeKey: 'note', name: 'Alice character', campaignIds: [a] });
    expect((await alice.entity.get({ id: mine.id })).campaignIds).toEqual([a]);

    // Leaving a campaign also leaves its parties.
    await dm.system.updateCampaign({ systemId, campaignId: a, memberIds: [] });
    expect((await dm.system.get({ systemId })).parties.find((p) => p.id === partyId)!.memberIds).toEqual([]);

    // A campaign with content cannot be deleted, so its content never falls open.
    expect(await code(dm.system.deleteCampaign({ systemId, campaignId: a }))).toBe('CONFLICT');
    await dm.entity.setCampaigns({ id: mine.id, campaignIds: [] });
    expect(await code(dm.system.deleteCampaign({ systemId, campaignId: a }))).toBe('OK');

    // An invite link can place the new player straight into a campaign.
    const { token } = await dm.system.createInvite({ systemId, role: 'player', campaignId: b });
    const carol = client(db);
    expect(await carol.auth.inviteInfo({ token })).toMatchObject({ valid: true, campaignName: 'CAMPAIGN-BETA' });
    await carol.auth.acceptInvite({ token, username: 'carol', displayName: 'Carol', password: 'carol-password' });
    expect((await carol.system.get({ systemId })).campaigns.map((c) => c.name)).toEqual(['CAMPAIGN-BETA']);
  });

  it('keeps systems fully apart', async () => {
    const { dm, systemId, alice } = await twoCampaigns();
    const rule = await dm.entity.create({ systemId, typeKey: 'note', name: 'DND-rule' });
    await dm.entity.setVisibility({ id: rule.id, audience: ALL });

    const { systemId: lancer } = await dm.system.create({ name: 'LANCER' });
    expect((await dm.system.list()).map((s) => s.name)).toEqual(['Test System', 'LANCER']);
    expect(await dm.entity.list({ systemId: lancer })).toEqual([]);
    expect((await dm.system.get({ systemId: lancer })).campaigns).toEqual([]);

    // A player of the first system is not in the second one.
    expect((await alice.system.list()).map((s) => s.name)).toEqual(['Test System']);
    expect(await code(alice.system.get({ systemId: lancer }))).toBe('NOT_FOUND');
    expect(await code(alice.entity.list({ systemId: lancer }))).toBe('NOT_FOUND');
  });
});
