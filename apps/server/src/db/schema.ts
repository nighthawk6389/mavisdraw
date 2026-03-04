import {
  pgTable,
  text,
  varchar,
  timestamp,
  boolean,
  integer,
  jsonb,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';

// ── Users ────────────────────────────────────────────────────

export const users = pgTable('users', {
  id: text('id').primaryKey(),
  email: varchar('email', { length: 255 }).notNull().unique(),
  name: varchar('name', { length: 255 }).notNull(),
  passwordHash: text('password_hash'),
  avatarUrl: text('avatar_url'),
  oauthProvider: varchar('oauth_provider', { length: 50 }),
  oauthProviderId: text('oauth_provider_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const usersRelations = relations(users, ({ many }) => ({
  sessions: many(sessions),
  projects: many(projects),
  permissions: many(projectPermissions),
  githubConnections: many(githubConnections),
}));

// ── Sessions ─────────────────────────────────────────────────

export const sessions = pgTable(
  'sessions',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    refreshToken: text('refresh_token').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('sessions_user_id_idx').on(table.userId)],
);

export const sessionsRelations = relations(sessions, ({ one }) => ({
  user: one(users, {
    fields: [sessions.userId],
    references: [users.id],
  }),
}));

// ── Projects ─────────────────────────────────────────────────

export const projects = pgTable(
  'projects',
  {
    id: text('id').primaryKey(),
    name: varchar('name', { length: 255 }).notNull(),
    ownerId: text('owner_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    rootDiagramId: text('root_diagram_id'),
    isPublic: boolean('is_public').notNull().default(false),
    thumbnailUrl: text('thumbnail_url'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('projects_owner_id_idx').on(table.ownerId)],
);

export const projectsRelations = relations(projects, ({ one, many }) => ({
  owner: one(users, {
    fields: [projects.ownerId],
    references: [users.id],
  }),
  diagrams: many(diagrams),
  permissions: many(projectPermissions),
}));

// ── Diagrams ─────────────────────────────────────────────────

export const diagrams = pgTable(
  'diagrams',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    parentDiagramId: text('parent_diagram_id'),
    parentPortalId: text('parent_portal_id'),
    title: varchar('title', { length: 255 }).notNull().default('Untitled Diagram'),
    elements: jsonb('elements').notNull().default([]),
    viewBackgroundColor: varchar('view_background_color', { length: 20 })
      .notNull()
      .default('#ffffff'),
    gridEnabled: boolean('grid_enabled').notNull().default(true),
    gridSize: integer('grid_size').notNull().default(20),
    renderMode: varchar('render_mode', { length: 20 }).notNull().default('sketchy'),
    layers: jsonb('layers').notNull().default([]),
    createdBy: text('created_by')
      .notNull()
      .references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('diagrams_project_id_idx').on(table.projectId),
    index('diagrams_parent_diagram_id_idx').on(table.parentDiagramId),
  ],
);

export const diagramsRelations = relations(diagrams, ({ one, many }) => ({
  project: one(projects, {
    fields: [diagrams.projectId],
    references: [projects.id],
  }),
  parentDiagram: one(diagrams, {
    fields: [diagrams.parentDiagramId],
    references: [diagrams.id],
    relationName: 'diagramParent',
  }),
  childDiagrams: many(diagrams, { relationName: 'diagramParent' }),
  snapshots: many(diagramSnapshots),
  creator: one(users, {
    fields: [diagrams.createdBy],
    references: [users.id],
  }),
}));

// ── Diagram Snapshots (Version History) ──────────────────────

export const diagramSnapshots = pgTable(
  'diagram_snapshots',
  {
    id: text('id').primaryKey(),
    diagramId: text('diagram_id')
      .notNull()
      .references(() => diagrams.id, { onDelete: 'cascade' }),
    version: integer('version').notNull(),
    elements: jsonb('elements').notNull(),
    appState: jsonb('app_state').notNull().default({}),
    createdBy: text('created_by')
      .notNull()
      .references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    trigger: varchar('trigger', { length: 20 }).notNull().default('auto'),
    label: varchar('label', { length: 255 }),
  },
  (table) => [
    index('diagram_snapshots_diagram_id_idx').on(table.diagramId),
    uniqueIndex('diagram_snapshots_diagram_version_idx').on(table.diagramId, table.version),
  ],
);

export const diagramSnapshotsRelations = relations(diagramSnapshots, ({ one }) => ({
  diagram: one(diagrams, {
    fields: [diagramSnapshots.diagramId],
    references: [diagrams.id],
  }),
  creator: one(users, {
    fields: [diagramSnapshots.createdBy],
    references: [users.id],
  }),
}));

// ── Project Permissions (Sharing) ────────────────────────────

export type PermissionRole = 'viewer' | 'editor' | 'admin';

export const projectPermissions = pgTable(
  'project_permissions',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    userId: text('user_id').references(() => users.id, { onDelete: 'cascade' }),
    email: varchar('email', { length: 255 }),
    role: varchar('role', { length: 20 }).notNull().default('viewer').$type<PermissionRole>(),
    shareToken: text('share_token'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('project_permissions_project_id_idx').on(table.projectId),
    index('project_permissions_user_id_idx').on(table.userId),
    uniqueIndex('project_permissions_share_token_idx').on(table.shareToken),
  ],
);

export const projectPermissionsRelations = relations(projectPermissions, ({ one }) => ({
  project: one(projects, {
    fields: [projectPermissions.projectId],
    references: [projects.id],
  }),
  user: one(users, {
    fields: [projectPermissions.userId],
    references: [users.id],
  }),
}));

// ── GitHub Connections ──────────────────────────────────────

export const githubConnections = pgTable(
  'github_connections',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    githubUserId: text('github_user_id').notNull(),
    githubUsername: varchar('github_username', { length: 255 }).notNull(),
    accessToken: text('access_token').notNull(),
    refreshToken: text('refresh_token'),
    scope: text('scope'),
    enterpriseUrl: text('enterprise_url'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('github_connections_user_id_idx').on(table.userId),
    uniqueIndex('github_connections_user_github_idx').on(table.userId, table.githubUserId),
  ],
);

export const githubConnectionsRelations = relations(githubConnections, ({ one }) => ({
  user: one(users, {
    fields: [githubConnections.userId],
    references: [users.id],
  }),
}));
