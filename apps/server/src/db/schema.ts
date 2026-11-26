import {
  pgTable,
  text,
  varchar,
  timestamp,
  boolean,
  integer,
  doublePrecision,
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
    /** Token replaced by the last rotation; still honoured for a short grace window. */
    previousRefreshToken: text('previous_refresh_token'),
    rotatedAt: timestamp('rotated_at', { withTimezone: true }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('sessions_user_id_idx').on(table.userId),
    index('sessions_refresh_token_idx').on(table.refreshToken),
    index('sessions_previous_refresh_token_idx').on(table.previousRefreshToken),
  ],
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
    /**
     * Collaboration document (Y.js update, base64). Source of truth while it
     * exists; cleared whenever `elements` is written directly so the next
     * live session re-seeds from the JSON.
     */
    yjsState: text('yjs_state'),
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

// ── Comments ─────────────────────────────────────────────────

/**
 * A comment thread pinned to a diagram. When `elementId` is set the pin
 * follows that element (offset from its top-left); x/y is where it was
 * placed, used if the element is gone.
 */
export const commentThreads = pgTable(
  'comment_threads',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    diagramId: text('diagram_id')
      .notNull()
      .references(() => diagrams.id, { onDelete: 'cascade' }),
    elementId: text('element_id'),
    x: doublePrecision('x').notNull(),
    y: doublePrecision('y').notNull(),
    offsetX: doublePrecision('offset_x').notNull().default(0),
    offsetY: doublePrecision('offset_y').notNull().default(0),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    resolvedBy: text('resolved_by').references(() => users.id, { onDelete: 'set null' }),
    createdBy: text('created_by')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('comment_threads_project_id_idx').on(table.projectId),
    index('comment_threads_diagram_id_idx').on(table.diagramId),
  ],
);

export const comments = pgTable(
  'comments',
  {
    id: text('id').primaryKey(),
    threadId: text('thread_id')
      .notNull()
      .references(() => commentThreads.id, { onDelete: 'cascade' }),
    authorId: text('author_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    body: text('body').notNull(),
    /** User ids @mentioned in the body. */
    mentions: jsonb('mentions').notNull().default([]).$type<string[]>(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    editedAt: timestamp('edited_at', { withTimezone: true }),
  },
  (table) => [index('comments_thread_id_idx').on(table.threadId)],
);

export type NotificationType = 'mention' | 'reply';

export const notifications = pgTable(
  'notifications',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    type: varchar('type', { length: 20 }).notNull().$type<NotificationType>(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    diagramId: text('diagram_id')
      .notNull()
      .references(() => diagrams.id, { onDelete: 'cascade' }),
    threadId: text('thread_id')
      .notNull()
      .references(() => commentThreads.id, { onDelete: 'cascade' }),
    commentId: text('comment_id')
      .notNull()
      .references(() => comments.id, { onDelete: 'cascade' }),
    actorId: text('actor_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    readAt: timestamp('read_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('notifications_user_id_idx').on(table.userId, table.createdAt)],
);

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
