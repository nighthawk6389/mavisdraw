import { and, eq, sql } from 'drizzle-orm';
import type { Document } from '@hocuspocus/server';
import { config, type GitHubAppConfig } from '../config.js';
import { db } from '../db/client.js';
import { diagramProposals, projects, type RepoSource } from '../db/schema.js';
import { checkProjectAccess } from './diagramService.js';
import { getDecryptedToken, repoAccess } from './githubService.js';
import { reportError } from '../observability.js';
import { installationClient, type InstallationClient } from './githubApp.js';
import { loadProjectScene } from './projectService.js';
import { loadStoredModel } from './modelService.js';
import { buildProjectModel } from '@mavisdraw/llm';
import { createProposal } from './proposalService.js';
import {
  affectsStructure,
  architectureDrift,
  COMMENT_MARKER,
  hasNews,
  impactOnProject,
  manifestsToRead,
  renderPrComment,
} from './prDrift.js';

/**
 * A pull request was opened or updated on a repository the GitHub App is
 * installed on: work out what it does to every map of that repository,
 * refresh the proposed map update, and keep one comment on the PR current.
 */

export interface PullRequestEvent {
  action: string;
  installation?: { id: number };
  repository: { full_name: string; name: string; owner: { login: string } };
  pull_request: {
    number: number;
    title: string;
    html_url: string;
    base: { sha: string };
    head: { sha: string };
  };
}

export const CHECKED_ACTIONS = new Set(['opened', 'synchronize', 'reopened', 'ready_for_review']);

/**
 * Maps generated from this repository (owner/repo, case-insensitive) whose
 * link was verified on the app's GitHub host: only someone who could read
 * the repository can have made it, so its PRs never leak into other maps.
 */
async function projectsForRepo(host: string, owner: string, repo: string) {
  return db
    .select({
      id: projects.id,
      name: projects.name,
      rootDiagramId: projects.rootDiagramId,
      repoSource: projects.repoSource,
    })
    .from(projects)
    .where(
      and(
        sql`${projects.repoSource}->>'kind' = 'github'`,
        sql`${projects.repoSource}->>'host' = ${host}`,
        sql`lower(${projects.repoSource}->>'owner') = ${owner.toLowerCase()}`,
        sql`lower(${projects.repoSource}->>'repo') = ${repo.toLowerCase()}`,
      ),
    );
}

const REVERIFY_AFTER_MS = 24 * 60 * 60 * 1000;

/**
 * Is the link still vouched for? Re-checked at most daily through the
 * linker's own GitHub connection: they must still push to the repository
 * and still own or administer the project. A link that fails is turned off.
 */
async function stillVerified(
  project: { id: string; repoSource: RepoSource | null },
  now = Date.now(),
): Promise<boolean> {
  const source = project.repoSource;
  if (!source?.host) return false;
  if (source.verifiedAt && now - Date.parse(source.verifiedAt) < REVERIFY_AFTER_MS) return true;
  let ok = false;
  try {
    const linker = source.generatedBy;
    const role = linker ? await checkProjectAccess(project.id, linker) : null;
    if (
      linker &&
      source.connectionId &&
      source.owner &&
      source.repo &&
      (role === 'owner' || role === 'admin')
    ) {
      const token = await getDecryptedToken(source.connectionId, linker);
      ok = !!(await repoAccess(token.accessToken, source.owner, source.repo, token.enterpriseUrl))
        ?.push;
    }
  } catch {
    ok = false;
  }
  const { host: _host, verifiedAt: _verifiedAt, ...rest } = source;
  await db
    .update(projects)
    .set({ repoSource: ok ? { ...source, verifiedAt: new Date(now).toISOString() } : rest })
    .where(eq(projects.id, project.id));
  return ok;
}

async function readAll(paths: string[], read: (path: string) => Promise<string | undefined>) {
  const out = new Map<string, string>();
  // A few at a time: kind to GitHub's rate limits, quick for typical repos
  for (let i = 0; i < paths.length; i += 8) {
    const batch = paths.slice(i, i + 8);
    const contents = await Promise.all(batch.map(read));
    batch.forEach((p, j) => {
      if (contents[j] !== undefined) out.set(p, contents[j]!);
    });
  }
  return out;
}

export async function checkPullRequest(
  event: PullRequestEvent,
  deps: {
    cfg: GitHubAppConfig;
    documents: Map<string, Document>;
    signal: (projectId: string) => void;
    client?: InstallationClient;
  },
): Promise<{ commented: 'created' | 'updated' | 'skipped'; projects: number }> {
  const owner = event.repository.owner.login;
  const repo = event.repository.name;
  const pr = event.pull_request;
  const linked = [];
  for (const project of await projectsForRepo(deps.cfg.webUrl, owner, repo)) {
    if (await stillVerified(project)) linked.push(project);
  }
  if (linked.length === 0 || !event.installation) return { commented: 'skipped', projects: 0 };

  const gh = deps.client ?? installationClient(deps.cfg, event.installation.id);
  const changes = await gh.pullRequestFiles(owner, repo, pr.number);

  let drift: ReturnType<typeof architectureDrift> = [];
  if (affectsStructure(changes)) {
    const baseFiles = await gh.tree(owner, repo, pr.base.sha);
    const toRead = manifestsToRead(baseFiles, changes);
    const [base, head] = await Promise.all([
      readAll(toRead.base, (p) => gh.content(owner, repo, p, pr.base.sha)),
      readAll(toRead.changed, (p) => gh.content(owner, repo, p, pr.head.sha)),
    ]);
    drift = architectureDrift({ repoName: repo, baseFiles, changes, base, head });
  }

  const impacts = [];
  const proposals = new Map<string, string>();
  for (const project of linked) {
    // One map's trouble (say, a full review queue) must not stop the others
    try {
      const scene = await loadProjectScene(project, deps.documents);
      const model = buildProjectModel(scene, await loadStoredModel(project.id), {
        repo: `${owner}/${repo}`,
      });
      const impact = impactOnProject({
        project: { id: project.id, name: project.name },
        scene,
        changes,
        drift,
        pr: { repo: `${owner}/${repo}`, number: pr.number, title: pr.title },
        model,
      });
      impacts.push(impact);

      // One pending proposal per PR and project: a new push replaces it
      const replaced = await db
        .update(diagramProposals)
        .set({ status: 'dismissed', resolvedAt: new Date() })
        .where(
          and(
            eq(diagramProposals.projectId, project.id),
            eq(diagramProposals.sourceUrl, pr.html_url),
            eq(diagramProposals.status, 'pending'),
          ),
        )
        .returning({ id: diagramProposals.id });
      if (impact.proposal) {
        const { id } = await createProposal({
          projectId: project.id,
          diagramId: impact.proposal.diagramId,
          authorId: null,
          source: 'pull_request',
          sourceLabel: `${owner}/${repo}#${pr.number}`,
          sourceUrl: pr.html_url,
          description: impact.proposal.built.description,
          changes: impact.proposal.built.changes,
          connections: impact.proposal.built.connections,
        });
        proposals.set(project.id, id);
      }
      if (impact.proposal || replaced.length > 0) deps.signal(project.id);
    } catch (err) {
      console.error(
        `[pr-checks] ${owner}/${repo}#${pr.number}: project ${project.id} failed:`,
        err,
      );
      reportError(err, { route: 'github-app:pull_request' });
    }
  }

  const body = renderPrComment({ impacts, headSha: pr.head.sha, appUrl: config.appUrl, proposals });
  // Only ever edit our own comment (a marker in someone else's means nothing)
  const ourLogin = deps.cfg.slug ? `${deps.cfg.slug}[bot]` : null;
  const existing = (await gh.comments(owner, repo, pr.number)).find(
    (c) =>
      c.user?.type === 'Bot' &&
      (!ourLogin || c.user.login === ourLogin) &&
      c.body.includes(COMMENT_MARKER),
  );
  if (existing) {
    if (existing.body !== body) await gh.updateComment(owner, repo, existing.id, body);
    return { commented: 'updated', projects: linked.length };
  }
  if (!hasNews(impacts)) return { commented: 'skipped', projects: linked.length };
  await gh.createComment(owner, repo, pr.number, body);
  return { commented: 'created', projects: linked.length };
}

/** Pushes in quick succession: check each PR one run at a time, in order. */
const queues = new Map<string, Promise<unknown>>();

export function enqueuePullRequestCheck(
  event: PullRequestEvent,
  deps: Parameters<typeof checkPullRequest>[1],
  log: { error: (obj: unknown, msg: string) => void },
): Promise<void> {
  const key = `${event.repository.full_name.toLowerCase()}#${event.pull_request.number}`;
  const run = (queues.get(key) ?? Promise.resolve())
    .catch(() => undefined)
    .then(() => checkPullRequest(event, deps))
    .then(() => undefined)
    .catch((err) => {
      log.error({ err, pr: key }, 'Pull request check failed');
      reportError(err, { route: 'github-app:pull_request' });
    })
    .finally(() => {
      if (queues.get(key) === run) queues.delete(key);
    });
  queues.set(key, run);
  return run;
}
