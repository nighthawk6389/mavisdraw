import { nanoid } from 'nanoid';
import { and, asc, count, eq } from 'drizzle-orm';
import type { ProposedChange, ProposedConnection } from '@mavisdraw/types';
import { db } from '../db/client.js';
import { diagramProposals, users } from '../db/schema.js';

/**
 * Proposed map updates waiting for a person: from coding agents (MCP) and,
 * later, pull-request checks. Nothing changes the map until someone with
 * edit access applies a proposal in the editor.
 */

export type ProposalStatus = 'pending' | 'applied' | 'dismissed';
export type ProposalSource = 'agent' | 'pull_request';

/** Keeps a runaway agent from burying a project in proposals. */
export const MAX_PENDING_PER_PROJECT = 100;

export interface ProposalView {
  id: string;
  projectId: string;
  diagramId: string;
  source: ProposalSource;
  sourceLabel: string;
  sourceUrl: string | null;
  authorName: string | null;
  description: string;
  changes: ProposedChange[];
  connections: ProposedConnection[];
  status: ProposalStatus;
  createdAt: string;
}

export class TooManyProposalsError extends Error {
  /** The message is meant for whoever asked (an agent, a reviewer). */
  readonly userFacing = true;
  constructor() {
    super(
      `This project already has ${MAX_PENDING_PER_PROJECT} proposals waiting for review. Ask a project member to go through them first.`,
    );
  }
}

export async function createProposal(input: {
  projectId: string;
  diagramId: string;
  authorId: string | null;
  source: ProposalSource;
  sourceLabel: string;
  sourceUrl?: string | null;
  description: string;
  changes: ProposedChange[];
  connections: ProposedConnection[];
}): Promise<{ id: string }> {
  const [{ pending }] = await db
    .select({ pending: count() })
    .from(diagramProposals)
    .where(
      and(eq(diagramProposals.projectId, input.projectId), eq(diagramProposals.status, 'pending')),
    );
  if (pending >= MAX_PENDING_PER_PROJECT) throw new TooManyProposalsError();
  const id = nanoid();
  await db.insert(diagramProposals).values({
    id,
    projectId: input.projectId,
    diagramId: input.diagramId,
    authorId: input.authorId,
    source: input.source,
    sourceLabel: input.sourceLabel.slice(0, 255),
    sourceUrl: input.sourceUrl ?? null,
    description: input.description,
    changes: input.changes,
    connections: input.connections,
  });
  return { id };
}

export async function listPendingProposals(projectId: string): Promise<ProposalView[]> {
  const rows = await db
    .select({ proposal: diagramProposals, authorName: users.name })
    .from(diagramProposals)
    .leftJoin(users, eq(users.id, diagramProposals.authorId))
    .where(and(eq(diagramProposals.projectId, projectId), eq(diagramProposals.status, 'pending')))
    .orderBy(asc(diagramProposals.createdAt));
  return rows.map(({ proposal: p, authorName }) => ({
    id: p.id,
    projectId: p.projectId,
    diagramId: p.diagramId,
    source: p.source as ProposalSource,
    sourceLabel: p.sourceLabel,
    sourceUrl: p.sourceUrl,
    authorName,
    description: p.description,
    changes: p.changes as ProposedChange[],
    connections: p.connections as ProposedConnection[],
    status: p.status as ProposalStatus,
    createdAt: p.createdAt.toISOString(),
  }));
}

export async function getProposal(id: string) {
  return db.query.diagramProposals.findFirst({ where: eq(diagramProposals.id, id) });
}

/**
 * Settle a proposal. Applying or dismissing only works on a pending one
 * (two reviewers can't both apply it); 'pending' reopens one whose apply
 * failed in the editor. Returns false when it was already settled.
 */
export async function resolveProposal(
  id: string,
  userId: string,
  status: ProposalStatus,
): Promise<boolean> {
  const from: ProposalStatus = status === 'pending' ? 'applied' : 'pending';
  const updated = await db
    .update(diagramProposals)
    .set(
      status === 'pending'
        ? { status, resolvedBy: null, resolvedAt: null }
        : { status, resolvedBy: userId, resolvedAt: new Date() },
    )
    .where(and(eq(diagramProposals.id, id), eq(diagramProposals.status, from)))
    .returning({ id: diagramProposals.id });
  return updated.length > 0;
}
