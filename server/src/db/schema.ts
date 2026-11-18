import { sqliteTable, text, integer, primaryKey, index } from 'drizzle-orm/sqlite-core';
import type { SchemaGroup } from '../schemas/types';
import type { Audience } from '../visibility';

export type Role = 'dm' | 'player';
export type Language = 'en' | 'ru';

export const users = sqliteTable('users', {
  id: text('id').primaryKey(),
  // Lower-cased login name.
  username: text('username').notNull().unique(),
  displayName: text('display_name').notNull(),
  passwordHash: text('password_hash').notNull(),
  language: text('language').$type<Language>().notNull().default('en'),
  createdAt: integer('created_at').notNull(),
});

export const sessions = sqliteTable('sessions', {
  // SHA-256 of the cookie token, so a leaked database does not leak live sessions.
  tokenHash: text('token_hash').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  expiresAt: integer('expires_at').notNull(),
});

/** Choices the DM makes once for everyone in a System. */
export type SystemSettings = {
  /** Keys of the fields shown on the cards of the character list, beyond portrait, name and allegiance. */
  cardFields?: string[];
};

export const systems = sqliteTable('systems', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  settings: text('settings', { mode: 'json' }).$type<SystemSettings>().notNull().default({}),
  // The version of the schemas its stored data fits (schemas/versions.ts). Every insert of a System
  // names it: a new System is at the current version, an imported one at the version of its file.
  // Systems from before versioning are at 0.
  schemaVersion: integer('schema_version').notNull().default(0),
  createdAt: integer('created_at').notNull(),
});

export const members = sqliteTable(
  'members',
  {
    systemId: text('system_id').notNull().references(() => systems.id, { onDelete: 'cascade' }),
    userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    role: text('role').$type<Role>().notNull(),
  },
  (t) => [primaryKey({ columns: [t.systemId, t.userId] })],
);

// A campaign is not a container. It is a tag on content inside a system, and a group of players:
// content tagged with a campaign is invisible to players outside that campaign.
export const campaigns = sqliteTable('campaigns', {
  id: text('id').primaryKey(),
  systemId: text('system_id').notNull().references(() => systems.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  createdAt: integer('created_at').notNull(),
});

export const campaignMembers = sqliteTable(
  'campaign_members',
  {
    campaignId: text('campaign_id').notNull().references(() => campaigns.id, { onDelete: 'cascade' }),
    userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  },
  (t) => [primaryKey({ columns: [t.campaignId, t.userId] })],
);

export const parties = sqliteTable('parties', {
  id: text('id').primaryKey(),
  systemId: text('system_id').notNull().references(() => systems.id, { onDelete: 'cascade' }),
  // Every party belongs to exactly one campaign and holds only that campaign's players.
  campaignId: text('campaign_id').notNull().references(() => campaigns.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
});

export const partyMembers = sqliteTable(
  'party_members',
  {
    partyId: text('party_id').notNull().references(() => parties.id, { onDelete: 'cascade' }),
    userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  },
  (t) => [primaryKey({ columns: [t.partyId, t.userId] })],
);

export const invites = sqliteTable('invites', {
  token: text('token').primaryKey(),
  systemId: text('system_id').notNull().references(() => systems.id, { onDelete: 'cascade' }),
  role: text('role').$type<Role>().notNull(),
  // A player invite may also add the new member to one campaign.
  campaignId: text('campaign_id').references(() => campaigns.id, { onDelete: 'cascade' }),
  createdBy: text('created_by').notNull(),
  usedBy: text('used_by'),
  createdAt: integer('created_at').notNull(),
  expiresAt: integer('expires_at').notNull(),
});

export const entities = sqliteTable(
  'entities',
  {
    id: text('id').primaryKey(),
    systemId: text('system_id').notNull().references(() => systems.id, { onDelete: 'cascade' }),
    typeKey: text('type_key').notNull(),
    name: text('name').notNull(),
    // Russian form of the name, shown after the English one to a Russian reader.
    nameRu: text('name_ru'),
    ownerId: text('owner_id'),
    // Campaigns this entity belongs to. Empty means campaign-agnostic (rules, items, spells).
    campaignIds: text('campaign_ids', { mode: 'json' }).$type<string[]>().notNull(),
    // Keys of the sheet modules attached to this entity.
    modules: text('modules', { mode: 'json' }).$type<string[]>().notNull().default([]),
    // Sections and fields added to this one entity only.
    customSchema: text('custom_schema', { mode: 'json' }).$type<SchemaGroup[]>().notNull().default([]),
    visibility: text('visibility', { mode: 'json' }).$type<Audience>().notNull(),
    // Per-entity audience overrides, keyed by group id or field id.
    fieldVisibility: text('field_visibility', { mode: 'json' }).$type<Record<string, Audience>>().notNull(),
    values: text('values', { mode: 'json' }).$type<Record<string, unknown>>().notNull(),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
    deletedAt: integer('deleted_at'),
  },
  (t) => [index('entities_system_type').on(t.systemId, t.typeKey)],
);

export const links = sqliteTable(
  'links',
  {
    id: text('id').primaryKey(),
    systemId: text('system_id').notNull().references(() => systems.id, { onDelete: 'cascade' }),
    fromId: text('from_id').notNull(),
    kind: text('kind').notNull(),
    toId: text('to_id').notNull(),
    data: text('data', { mode: 'json' }).$type<Record<string, unknown>>().notNull(),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [index('links_from').on(t.fromId), index('links_to').on(t.toId)],
);

export type ChangeTarget =
  | 'create'
  | 'delete'
  | 'restore'
  | 'name'
  | 'field'
  | 'owner'
  | 'campaigns'
  | 'modules'
  | 'nameRu'
  | 'customSchema'
  | 'translation'
  | 'visibility'
  | 'fieldVisibility'
  | 'link';

export const changes = sqliteTable(
  'changes',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    systemId: text('system_id').notNull().references(() => systems.id, { onDelete: 'cascade' }),
    entityId: text('entity_id').notNull(),
    target: text('target').$type<ChangeTarget>().notNull(),
    // Field id, group id or link id, depending on the target.
    key: text('key'),
    oldValue: text('old_value', { mode: 'json' }).$type<unknown>(),
    newValue: text('new_value', { mode: 'json' }).$type<unknown>(),
    userId: text('user_id').notNull(),
    at: integer('at').notNull(),
  },
  (t) => [index('changes_entity').on(t.entityId, t.id)],
);

/** Russian text of one long-text field. English is always the source. */
export const translations = sqliteTable(
  'translations',
  {
    entityId: text('entity_id').notNull().references(() => entities.id, { onDelete: 'cascade' }),
    fieldId: text('field_id').notNull(),
    lang: text('lang').$type<Language>().notNull(),
    text: text('text').notNull(),
    // The English text this was translated from. When the English no longer equals it, the translation is outdated.
    sourceSnapshot: text('source_snapshot').notNull(),
    updatedBy: text('updated_by').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [primaryKey({ columns: [t.entityId, t.fieldId, t.lang] })],
);

/** Uploaded images. The bytes live in the uploads folder next to the database. */
export const files = sqliteTable(
  'files',
  {
    id: text('id').primaryKey(),
    systemId: text('system_id').notNull().references(() => systems.id, { onDelete: 'cascade' }),
    entityId: text('entity_id').notNull(),
    fieldId: text('field_id').notNull(),
    mime: text('mime').notNull(),
    size: integer('size').notNull(),
    createdBy: text('created_by').notNull(),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [index('files_entity').on(t.entityId)],
);

export type RequestStatus = 'open' | 'resolved';

/**
 * A thread between one player and the DMs of a System (PLAN.md 10.4).
 * Not an entity: no schema, no audience. Its player and the DMs see it, nobody else.
 */
export const requests = sqliteTable(
  'requests',
  {
    id: text('id').primaryKey(),
    systemId: text('system_id').notNull().references(() => systems.id, { onDelete: 'cascade' }),
    // The player the thread belongs to. It stays when the player leaves the System, so the DM keeps the thread.
    playerId: text('player_id').notNull(),
    subject: text('subject').notNull(),
    status: text('status').$type<RequestStatus>().notNull().default('open'),
    // Who started it: the player, or a DM writing to the player.
    createdBy: text('created_by').notNull(),
    createdAt: integer('created_at').notNull(),
    // Time of the last message, or of the last resolve or reopen.
    updatedAt: integer('updated_at').notNull(),
    resolvedAt: integer('resolved_at'),
  },
  (t) => [index('requests_system').on(t.systemId, t.playerId)],
);

/** One message of a request: rich text, cleaned on the server. Never changed after it is sent. */
export const requestMessages = sqliteTable(
  'request_messages',
  {
    id: text('id').primaryKey(),
    requestId: text('request_id').notNull().references(() => requests.id, { onDelete: 'cascade' }),
    authorId: text('author_id').notNull(),
    body: text('body').notNull(),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [index('request_messages_request').on(t.requestId, t.createdAt)],
);
