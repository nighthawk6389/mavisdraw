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
  primaryKey,
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
  /**
   * When they proved they own the email (confirmation link, or an invite link
   * sent to it). Until then, invites to the address aren't granted to them.
   */
  emailVerifiedAt: timestamp('email_verified_at', { withTimezone: true }),
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
    /** Team space the project belongs to (its members get access); null = personal. */
    workspaceId: text('workspace_id').references(() => workspaces.id, { onDelete: 'set null' }),
    /** Dashboard folder (a name, shared by everyone who sees the project). */
    folder: varchar('folder', { length: 100 }),
    /**
     * The repository the map was generated from, and the architecture model
     * at that time (drift is measured against it).
     */
    repoSource: jsonb('repo_source').$type<RepoSource | null>(),
    /** Check pull requests on the linked repository (the GitHub App; docs/pr-checks.md). */
    prChecksEnabled: boolean('pr_checks_enabled').notNull().default(true),
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

// ── Workspaces (teams) ───────────────────────────────────────

export type WorkspaceRole = 'owner' | 'admin' | 'member';

export const workspaces = pgTable('workspaces', {
  id: text('id').primaryKey(),
  name: varchar('name', { length: 120 }).notNull(),
  createdBy: text('created_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const workspaceMembers = pgTable(
  'workspace_members',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: varchar('role', { length: 20 }).notNull().default('member').$type<WorkspaceRole>(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('workspace_members_unique_idx').on(table.workspaceId, table.userId),
    index('workspace_members_user_idx').on(table.userId),
  ],
);

/** An invitation by email to a project or a workspace, claimable by that email's account. */
export const invites = pgTable(
  'invites',
  {
    id: text('id').primaryKey(),
    kind: varchar('kind', { length: 20 }).notNull().$type<'project' | 'workspace'>(),
    targetId: text('target_id').notNull(),
    email: varchar('email', { length: 255 }).notNull(),
    role: varchar('role', { length: 20 }).notNull(),
    token: text('token').notNull(),
    invitedBy: text('invited_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    acceptedAt: timestamp('accepted_at', { withTimezone: true }),
    acceptedBy: text('accepted_by').references(() => users.id, { onDelete: 'set null' }),
  },
  (table) => [
    uniqueIndex('invites_token_idx').on(table.token),
    index('invites_email_idx').on(table.email),
    index('invites_target_idx').on(table.kind, table.targetId),
  ],
);

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

// ── Repository the map was generated from ───────────────────

export interface RepoSource {
  kind: 'github' | 'folder';
  /** "owner/repo@ref" or the folder's name. */
  label: string;
  owner?: string;
  repo?: string;
  ref?: string;
  connectionId?: string;
  /**
   * GitHub host the link was verified on, set by the server only when the
   * linker is a project owner/admin whose GitHub connection can push to the
   * repository. Pull-request checks only use such links.
   */
  host?: string;
  /** When that access was last confirmed (re-checked daily through the linker's connection). */
  verifiedAt?: string;
  /** Architecture model (see @mavisdraw/compat analyzeRepo) at generation time. */
  model: unknown;
  generatedAt: string;
  generatedBy: string;
}

// ── Tours (presentation paths through the map) ──────────────

export interface TourStop {
  id: string;
  diagramId: string;
  /** Saved camera; null means "fit the diagram's content". */
  viewport: { zoom: number; scrollX: number; scrollY: number } | null;
  title: string;
  note: string;
}

export const projectTours = pgTable('project_tours', {
  projectId: text('project_id')
    .primaryKey()
    .references(() => projects.id, { onDelete: 'cascade' }),
  stops: jsonb('stops').notNull().default([]).$type<TourStop[]>(),
  updatedBy: text('updated_by').references(() => users.id, { onDelete: 'set null' }),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

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

// ── Access tokens (coding agents over MCP) ──────────────────

export const apiTokens = pgTable(
  'api_tokens',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** What the person called it ("Claude Code on my laptop"). */
    name: varchar('name', { length: 100 }).notNull(),
    /** SHA-256 of the token: the token itself is shown once and never stored. */
    tokenHash: text('token_hash').notNull(),
    /** Its first characters, so people can tell tokens apart. */
    prefix: varchar('prefix', { length: 16 }).notNull(),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('api_tokens_user_id_idx').on(table.userId),
    uniqueIndex('api_tokens_token_hash_idx').on(table.tokenHash),
  ],
);

// ── Proposed map updates (from coding agents and PR checks) ─

export const diagramProposals = pgTable(
  'diagram_proposals',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    diagramId: text('diagram_id')
      .notNull()
      .references(() => diagrams.id, { onDelete: 'cascade' }),
    /** Whose behalf it was proposed on (the token's owner). */
    authorId: text('author_id').references(() => users.id, { onDelete: 'set null' }),
    /** 'agent' (MCP) or 'pull_request'. */
    source: varchar('source', { length: 20 }).notNull(),
    /** Shown as "from …": the token's name, or "acme/shop#12". */
    sourceLabel: varchar('source_label', { length: 255 }).notNull(),
    sourceUrl: text('source_url'),
    description: text('description').notNull(),
    changes: jsonb('changes').notNull().default([]),
    connections: jsonb('connections').notNull().default([]),
    /** pending | applied | dismissed */
    status: varchar('status', { length: 20 }).notNull().default('pending'),
    resolvedBy: text('resolved_by').references(() => users.id, { onDelete: 'set null' }),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    /** Sent by the editor that resolved it: the same request again is answered as done. */
    resolutionKey: varchar('resolution_key', { length: 64 }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('diagram_proposals_project_status_idx').on(table.projectId, table.status)],
);

// ── Published embeds (read-only, public, revocable) ─────────

export const projectEmbeds = pgTable(
  'project_embeds',
  {
    projectId: text('project_id')
      .primaryKey()
      .references(() => projects.id, { onDelete: 'cascade' }),
    /** The capability in the public URL; rotating it breaks old links. */
    token: text('token').notNull(),
    createdBy: text('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex('project_embeds_token_idx').on(table.token)],
);

// ── The architecture model (docs/model-layer.md) ────────────
// Identity and names live on the shapes (componentId, labels); these
// tables hold what drawings can't say.

export const modelComponents = pgTable(
  'model_components',
  {
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    /** The component id shapes carry (unique within the project). */
    id: text('id').notNull(),
    /** Last known name (the name of model-only components; labels win otherwise). */
    name: varchar('name', { length: 255 }).notNull(),
    /** service | datastore | queue | external | system | person | other (null: from the shape) */
    kind: varchar('kind', { length: 20 }),
    description: text('description'),
    technology: varchar('technology', { length: 255 }),
    owner: varchar('owner', { length: 255 }),
    tags: jsonb('tags').$type<string[]>().notNull().default([]),
    links: jsonb('links').$type<Array<{ label: string; url: string }>>().notNull().default([]),
    updatedBy: text('updated_by').references(() => users.id, { onDelete: 'set null' }),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.projectId, table.id] })],
);

export const modelRelationships = pgTable(
  'model_relationships',
  {
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    sourceId: text('source_id').notNull(),
    targetId: text('target_id').notNull(),
    description: text('description'),
    technology: varchar('technology', { length: 255 }),
    updatedBy: text('updated_by').references(() => users.id, { onDelete: 'set null' }),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.projectId, table.sourceId, table.targetId] })],
);

// ── Single sign-on identities ───────────────────────────────
// Who someone is at an OpenID Connect provider (issuer + subject), linked to
// their MavisDraw account. Emails can change; the subject doesn't.

export const userIdentities = pgTable(
  'user_identities',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    issuer: text('issuer').notNull(),
    subject: text('subject').notNull(),
    /** The email the provider gave at the last sign-in. */
    email: varchar('email', { length: 255 }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    lastSignInAt: timestamp('last_sign_in_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('user_identities_issuer_subject_idx').on(table.issuer, table.subject),
    index('user_identities_user_idx').on(table.userId),
  ],
);
