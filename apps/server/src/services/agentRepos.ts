import { eq, sql } from 'drizzle-orm';
import { config, originOf } from '../config.js';
import { db } from '../db/client.js';
import { githubConnections, projects } from '../db/schema.js';

/**
 * The repositories the AI assistant may read for a project: the one the map
 * is linked to, and those its portals link to. Worked out by the server from
 * what's saved, never taken from the request, so text in a diagram can't
 * point the assistant at some other repository the person's GitHub token
 * happens to reach.
 */

export interface LinkedRepo {
  owner: string;
  repo: string;
  /** Branch, tag or commit the link names (null: the default branch). */
  ref: string | null;
  /** GitHub's web origin: github.com or this server's Enterprise host. */
  host: string;
}

/** At most this many repositories are offered (a project rarely links more than a few). */
const MAX_REPOS = 20;
const NAME = /^[A-Za-z0-9_.-]{1,100}$/;

/** A host this server talks to, or null (any other host is never contacted). */
export function allowedHost(url: string | null | undefined): string | null {
  if (!url) return config.github.cloud.url;
  const origin = originOf(url);
  if (origin === config.github.cloud.url) return origin;
  return config.github.enterprise && origin === originOf(config.github.enterprise.url)
    ? origin
    : null;
}

/** Each repository once (names are case-insensitive), well-formed and on a known host. */
export function uniqueRepos(
  candidates: Array<{
    owner?: string | null;
    repo?: string | null;
    ref?: string | null;
    host: string | null;
  }>,
): LinkedRepo[] {
  const seen = new Set<string>();
  const repos: LinkedRepo[] = [];
  for (const c of candidates) {
    if (!c.host || !c.owner || !c.repo || !NAME.test(c.owner) || !NAME.test(c.repo)) continue;
    const key = `${c.host}|${c.owner.toLowerCase()}/${c.repo.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    repos.push({ owner: c.owner, repo: c.repo, ref: c.ref?.trim() || null, host: c.host });
    if (repos.length === MAX_REPOS) break;
  }
  return repos;
}

/** The repository the assistant asked for ("owner/name"), if it's one of the linked ones. */
export function findLinkedRepo(repos: LinkedRepo[], name: string): LinkedRepo | null {
  const wanted = name.trim().toLowerCase();
  return repos.find((r) => `${r.owner}/${r.repo}`.toLowerCase() === wanted) ?? null;
}

export async function linkedRepositories(projectId: string): Promise<LinkedRepo[]> {
  const project = await db.query.projects.findFirst({
    where: eq(projects.id, projectId),
    columns: { repoSource: true },
  });
  const candidates: Parameters<typeof uniqueRepos>[0] = [];
  const source = project?.repoSource;
  if (source?.kind === 'github') {
    // The host it was verified on, else the linker's connection's
    let host = source.host ?? null;
    if (!host && source.connectionId) {
      const conn = await db.query.githubConnections.findFirst({
        where: eq(githubConnections.id, source.connectionId),
        columns: { enterpriseUrl: true },
      });
      host = conn ? (conn.enterpriseUrl ?? config.github.cloud.url) : null;
    }
    candidates.push({ ...source, host: allowedHost(host ?? config.github.cloud.url) });
  }
  // Portals linked to code, across the project's diagrams
  const rows = await db.execute<{
    owner: string;
    repo: string;
    ref: string | null;
    host: string | null;
  }>(sql`
    select distinct
      e->'githubLink'->>'owner' as owner,
      e->'githubLink'->>'repo' as repo,
      e->'githubLink'->>'ref' as ref,
      e->'githubLink'->>'enterpriseUrl' as host
    from diagrams d
    cross join lateral jsonb_array_elements(
      case when jsonb_typeof(d.elements) = 'array' then d.elements else '[]'::jsonb end
    ) e
    where d.project_id = ${projectId}
      and e->>'type' = 'portal'
      and jsonb_typeof(e->'githubLink') = 'object'
      and coalesce(e->>'isDeleted', 'false') <> 'true'
    limit ${MAX_REPOS * 5}
  `);
  for (const row of rows) candidates.push({ ...row, host: allowedHost(row.host) });
  return uniqueRepos(candidates);
}
