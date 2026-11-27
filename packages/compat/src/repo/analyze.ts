/**
 * Repository → architecture model.
 *
 * Works from a file list plus the contents of a few manifests (package.json,
 * workspace files, docker-compose, go.mod, Cargo.toml, pyproject.toml), so it
 * can run on a GitHub tree or a local folder without reading source files.
 * It finds the deployable apps and shared libraries, the datastores and
 * external services they use, and how they depend on each other.
 */

export interface RepoSnapshot {
  /** Repository (or folder) name. */
  name: string;
  /** Every file path, posix, relative to the repo root. */
  files: string[];
  /** Contents of a file, when available (only manifests are needed). */
  read: (path: string) => string | undefined;
}

export type ComponentKind = 'app' | 'library';
export type ResourceKind = 'datastore' | 'queue' | 'external';

export interface RepoComponent {
  /** Stable id: the component's path ('.' for the repo root). */
  id: string;
  name: string;
  path: string;
  kind: ComponentKind;
  description: string | null;
  /** Main folders inside it, with how many files each has (for its nested level). */
  modules: Array<{ name: string; files: number }>;
  /** Other components it depends on (ids). */
  dependsOn: string[];
  /** Resources it uses (ids). */
  uses: string[];
}

export interface RepoResource {
  id: string;
  name: string;
  kind: ResourceKind;
}

export interface RepoModel {
  name: string;
  components: RepoComponent[];
  resources: RepoResource[];
}

/** Manifest files the analyzer reads (callers fetch only these). */
export function isManifest(path: string): boolean {
  const base = path.split('/').pop() ?? '';
  return (
    base === 'package.json' ||
    base === 'pnpm-workspace.yaml' ||
    base === 'go.mod' ||
    base === 'Cargo.toml' ||
    base === 'pyproject.toml' ||
    /^(docker-)?compose(\.[\w-]+)?\.ya?ml$/.test(base)
  );
}

const IGNORED_DIR =
  /(^|\/)(node_modules|\.git|dist|build|out|coverage|vendor|target|\.next|\.turbo|__pycache__|\.venv)(\/|$)/;
const TEST_DIR = /(^|\/)(e2e|e2e-[\w-]+|__tests__|tests?|fixtures|examples?|docs?)(\/|$)/;

/** Paths worth looking at (no dependencies, build output or test fixtures). */
export function isRelevantPath(path: string): boolean {
  return !IGNORED_DIR.test(path);
}

const dirOf = (path: string) => (path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '.');
const baseName = (path: string) => (path === '.' ? '' : path.split('/').pop()!);

// ── Known resources, by dependency name or container image ─────────────

const RESOURCE_BY_DEP: Array<[RegExp, RepoResource]> = [
  [
    /^(pg|postgres|pg-promise|@neondatabase\/serverless|@vercel\/postgres)$/,
    { id: 'postgres', name: 'PostgreSQL', kind: 'datastore' },
  ],
  [/^(mysql2?|@planetscale\/database)$/, { id: 'mysql', name: 'MySQL', kind: 'datastore' }],
  [/^(mongodb|mongoose)$/, { id: 'mongodb', name: 'MongoDB', kind: 'datastore' }],
  [/^(redis|ioredis|@upstash\/redis)$/, { id: 'redis', name: 'Redis', kind: 'datastore' }],
  [/^(sqlite3|better-sqlite3)$/, { id: 'sqlite', name: 'SQLite', kind: 'datastore' }],
  [/^@elastic\/elasticsearch$/, { id: 'elasticsearch', name: 'Elasticsearch', kind: 'datastore' }],
  [/^(bullmq|bull)$/, { id: 'redis', name: 'Redis', kind: 'datastore' }],
  [/^kafkajs$/, { id: 'kafka', name: 'Kafka', kind: 'queue' }],
  [/^(amqplib|amqp-connection-manager)$/, { id: 'rabbitmq', name: 'RabbitMQ', kind: 'queue' }],
  [/^@aws-sdk\/client-sqs$/, { id: 'sqs', name: 'Amazon SQS', kind: 'queue' }],
  [/^@aws-sdk\/client-s3$/, { id: 's3', name: 'Amazon S3', kind: 'datastore' }],
  [/^stripe$/, { id: 'stripe', name: 'Stripe', kind: 'external' }],
  [
    /^(@anthropic-ai\/sdk|@ai-sdk\/anthropic)$/,
    { id: 'anthropic', name: 'Anthropic API', kind: 'external' },
  ],
  [/^(openai|@ai-sdk\/openai)$/, { id: 'openai', name: 'OpenAI API', kind: 'external' }],
  [/^(@octokit\/.+|octokit)$/, { id: 'github', name: 'GitHub API', kind: 'external' }],
  [/^@sendgrid\/mail$/, { id: 'sendgrid', name: 'SendGrid', kind: 'external' }],
  [/^twilio$/, { id: 'twilio', name: 'Twilio', kind: 'external' }],
  [/^@sentry\/.+$/, { id: 'sentry', name: 'Sentry', kind: 'external' }],
  [/^@supabase\/supabase-js$/, { id: 'supabase', name: 'Supabase', kind: 'external' }],
  [/^firebase(-admin)?$/, { id: 'firebase', name: 'Firebase', kind: 'external' }],
];

const RESOURCE_BY_IMAGE: Array<[RegExp, RepoResource]> = [
  [
    /^(postgres|postgis\/postgis|timescale)/,
    { id: 'postgres', name: 'PostgreSQL', kind: 'datastore' },
  ],
  [/^(mysql|mariadb)/, { id: 'mysql', name: 'MySQL', kind: 'datastore' }],
  [/^mongo/, { id: 'mongodb', name: 'MongoDB', kind: 'datastore' }],
  [/^(redis|valkey)/, { id: 'redis', name: 'Redis', kind: 'datastore' }],
  [/^(rabbitmq)/, { id: 'rabbitmq', name: 'RabbitMQ', kind: 'queue' }],
  [/(kafka|redpanda)/, { id: 'kafka', name: 'Kafka', kind: 'queue' }],
  [
    /^(elasticsearch|docker\.elastic\.co|opensearch)/,
    { id: 'elasticsearch', name: 'Elasticsearch', kind: 'datastore' },
  ],
  [/^(minio)/, { id: 's3', name: 'Object storage', kind: 'datastore' }],
];

function resourceForDep(dep: string): RepoResource | null {
  for (const [re, res] of RESOURCE_BY_DEP) if (re.test(dep)) return res;
  return null;
}

function resourceForImage(image: string): RepoResource | null {
  const name = image.split('/').slice(-2).join('/').toLowerCase();
  for (const [re, res] of RESOURCE_BY_IMAGE)
    if (re.test(name) || re.test(image.toLowerCase())) return res;
  return null;
}

// ── Manifest readers ───────────────────────────────────────────────────

interface PackageJson {
  name?: string;
  description?: string;
  private?: boolean;
  workspaces?: string[] | { packages?: string[] };
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
}

function parseJson<T>(text: string | undefined): T | null {
  if (!text) return null;
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

/** A YAML line without its trailing comment (`#` after whitespace), in linear time. */
function stripComment(line: string): string {
  for (let i = 1; i < line.length; i++) {
    if (line[i] === '#' && (line[i - 1] === ' ' || line[i - 1] === '\t')) {
      return line.slice(0, i).trimEnd();
    }
  }
  return line.startsWith('#') ? '' : line;
}

/** `name = "…"` in Cargo.toml's [package] section, without a backtracking regex. */
function cargoPackageName(text: string): string | undefined {
  let inPackage = false;
  for (const raw of text.split('\n')) {
    if (raw.length > MAX_LINE_CHARS) continue;
    const line = raw.trim();
    if (line.startsWith('[')) {
      inPackage = line === '[package]';
      continue;
    }
    if (!inPackage) continue;
    const m = /^name[ \t]*=[ \t]*"([^"]+)"/.exec(line);
    if (m) return m[1];
  }
  return undefined;
}

/** Minimal docker-compose reader: services with their image, build context and depends_on. */
export function parseCompose(
  text: string,
): Array<{ name: string; image: string | null; build: string | null; dependsOn: string[] }> {
  const lines = text.replace(/\t/g, '  ').split('\n');
  const services: Array<{
    name: string;
    image: string | null;
    build: string | null;
    dependsOn: string[];
  }> = [];
  let inServices = false;
  let servicesIndent = -1;
  let current: (typeof services)[number] | null = null;
  let serviceIndent = -1;
  let inDepends = false;
  let dependsIndent = -1;

  for (const full of lines) {
    if (full.length > MAX_LINE_CHARS) continue;
    const line = stripComment(full);
    if (!line.trim()) continue;
    const indent = line.length - line.trimStart().length;
    const trimmed = line.trim();

    if (indent === 0) {
      inServices = trimmed === 'services:';
      current = null;
      continue;
    }
    if (!inServices) continue;
    if (servicesIndent < 0) servicesIndent = indent;

    if (indent === servicesIndent && /^[\w.-]+:\s*$/.test(trimmed)) {
      current = { name: trimmed.slice(0, -1), image: null, build: null, dependsOn: [] };
      services.push(current);
      serviceIndent = -1;
      inDepends = false;
      continue;
    }
    if (!current || indent <= servicesIndent) continue;
    if (serviceIndent < 0) serviceIndent = indent;

    if (inDepends && indent > dependsIndent) {
      const item = trimmed.replace(/^-\s*/, '').replace(/:\s*$/, '').replace(/["']/g, '');
      if (item && !item.includes(' ')) current.dependsOn.push(item);
      continue;
    }
    inDepends = false;

    if (indent === serviceIndent) {
      const m = /^([\w-]+):\s*(.*)$/.exec(trimmed);
      if (!m) continue;
      const [, key, value] = m;
      const v = value.replace(/["']/g, '').trim();
      if (key === 'image') current.image = v || null;
      if (key === 'build') current.build = v || '.';
      if (key === 'depends_on') {
        if (v.startsWith('[')) {
          current.dependsOn.push(
            ...v
              .replace(/[[\]]/g, '')
              .split(',')
              .map((s) => s.trim())
              .filter(Boolean),
          );
        } else {
          inDepends = true;
          dependsIndent = indent;
        }
      }
    } else if (current.build === '.' && /^context:\s*/.test(trimmed)) {
      current.build = trimmed.replace(/^context:\s*/, '').replace(/["']/g, '') || '.';
    }
  }
  return services;
}

/** Directories (relative to `root`) that hold source, with their file counts. */
function modulesOf(files: string[], root: string): Array<{ name: string; files: number }> {
  const prefix = root === '.' ? '' : `${root}/`;
  const inside = files.filter(
    (f) => f.startsWith(prefix) && !TEST_DIR.test(f.slice(prefix.length)),
  );
  const hasSrc = inside.some((f) => f.startsWith(`${prefix}src/`));
  const base = hasSrc ? `${prefix}src/` : prefix;
  const counts = new Map<string, number>();
  for (const f of inside) {
    if (!f.startsWith(base)) continue;
    const rest = f.slice(base.length);
    const slash = rest.indexOf('/');
    if (slash <= 0) continue;
    const dir = rest.slice(0, slash);
    if (dir.startsWith('.')) continue;
    counts.set(dir, (counts.get(dir) ?? 0) + 1);
  }
  return Array.from(counts, ([name, n]) => ({ name, files: n }))
    .sort((a, b) => b.files - a.files || a.name.localeCompare(b.name))
    .slice(0, 8);
}

function displayName(pkgName: string | undefined, path: string, repoName: string): string {
  if (pkgName) return pkgName.replace(/^@[^/]+\//, '');
  return path === '.' ? repoName : baseName(path);
}

function kindOf(path: string, pkg: PackageJson | null, files: Set<string>): ComponentKind {
  if (/^(packages|libs?|shared|modules)\//.test(path)) return 'library';
  if (/^(apps|services|servers?|web|api|cmd)\b/.test(path)) return 'app';
  const prefix = path === '.' ? '' : `${path}/`;
  if (files.has(`${prefix}Dockerfile`)) return 'app';
  const scripts = pkg?.scripts ?? {};
  if (scripts.start || scripts.dev || scripts.serve) return 'app';
  return 'library';
}

/**
 * Manifests are small; anything bigger is not one worth reading (and the
 * analyzer runs on files from pull requests, so input sizes must be bounded).
 */
export const MAX_MANIFEST_CHARS = 256 * 1024;
const MAX_LINE_CHARS = 4000;

/** A manifest's text, or undefined when missing or too big to be a real one. */
function readManifest(snapshot: RepoSnapshot, path: string): string | undefined {
  const text = snapshot.read(path);
  return text !== undefined && text.length <= MAX_MANIFEST_CHARS ? text : undefined;
}

/** Build the architecture model of a repository. */
export function analyzeRepo(snapshot: RepoSnapshot): RepoModel {
  const files = snapshot.files.filter(isRelevantPath);
  const fileSet = new Set(files);

  // ── Components: every package manifest outside tests and build output
  type Found = { path: string; pkg: PackageJson | null; goModule?: string; cargoName?: string };
  const found = new Map<string, Found>();
  for (const f of files) {
    const base = f.split('/').pop()!;
    const dir = dirOf(f);
    if (TEST_DIR.test(dir === '.' ? '' : `${dir}/`)) continue;
    if (dir.split('/').length > 4) continue;
    if (base === 'package.json') {
      found.set(dir, {
        ...(found.get(dir) ?? { path: dir }),
        pkg: parseJson<PackageJson>(readManifest(snapshot, f)),
      });
    } else if (base === 'go.mod') {
      const mod = /^module[ \t]+(\S+)/m.exec(readManifest(snapshot, f) ?? '')?.[1];
      found.set(dir, { ...(found.get(dir) ?? { path: dir, pkg: null }), goModule: mod });
    } else if (base === 'Cargo.toml') {
      const text = readManifest(snapshot, f) ?? '';
      const name = cargoPackageName(text);
      if (name)
        found.set(dir, { ...(found.get(dir) ?? { path: dir, pkg: null }), cargoName: name });
    } else if (base === 'pyproject.toml') {
      const name = /^[ \t]*name[ \t]*=[ \t]*"([^"\n]+)"/m.exec(
        readManifest(snapshot, f) ?? '',
      )?.[1];
      if (name && !found.has(dir)) found.set(dir, { path: dir, pkg: { name } });
    }
  }

  // A workspace root (npm/yarn/pnpm workspaces) is a container, not a component
  const root = found.get('.');
  const rootIsWorkspace =
    !!root?.pkg?.workspaces || fileSet.has('pnpm-workspace.yaml') || (found.size > 1 && !!root);
  if (root && rootIsWorkspace && found.size > 1) found.delete('.');

  const byPackageName = new Map<string, string>();
  for (const c of found.values()) {
    if (c.pkg?.name) byPackageName.set(c.pkg.name, c.path);
    if (c.goModule) byPackageName.set(c.goModule, c.path);
    if (c.cargoName) byPackageName.set(c.cargoName, c.path);
  }

  const resources = new Map<string, RepoResource>();
  const components: RepoComponent[] = [];
  for (const c of found.values()) {
    const deps = new Set<string>();
    const uses = new Set<string>();
    const pkg = c.pkg;
    const runtime = { ...pkg?.dependencies, ...pkg?.peerDependencies };
    const workspaceDev = Object.entries(pkg?.devDependencies ?? {})
      .filter(([, v]) => v.startsWith('workspace:'))
      .map(([k]) => k);
    for (const dep of [...Object.keys(runtime), ...workspaceDev]) {
      const internal = byPackageName.get(dep);
      if (internal && internal !== c.path) {
        deps.add(internal);
        continue;
      }
      const res = resourceForDep(dep);
      if (res) {
        resources.set(res.id, res);
        uses.add(res.id);
      }
    }
    // Go: internal modules this one requires
    if (c.goModule) {
      const text = readManifest(snapshot, c.path === '.' ? 'go.mod' : `${c.path}/go.mod`) ?? '';
      for (const [mod, path] of byPackageName) {
        if (
          path !== c.path &&
          new RegExp(`\\b${mod.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(text)
        ) {
          deps.add(path);
        }
      }
    }
    components.push({
      id: c.path,
      name: displayName(
        pkg?.name ?? c.cargoName ?? c.goModule?.split('/').pop(),
        c.path,
        snapshot.name,
      ),
      path: c.path,
      kind: kindOf(c.path, pkg, fileSet),
      description: pkg?.description?.trim() || null,
      modules: modulesOf(files, c.path),
      dependsOn: Array.from(deps).sort(),
      uses: Array.from(uses).sort(),
    });
  }

  // ── docker-compose: infrastructure, and which app uses it
  for (const f of files.filter((p) => /(^|\/)(docker-)?compose(\.[\w-]+)?\.ya?ml$/.test(p))) {
    const services = parseCompose(readManifest(snapshot, f) ?? '');
    const composeDir = dirOf(f);
    const serviceToComponent = new Map<string, string>();
    const serviceToResource = new Map<string, string>();
    for (const s of services) {
      const image = s.image ? resourceForImage(s.image) : null;
      if (image) {
        resources.set(image.id, image);
        serviceToResource.set(s.name, image.id);
      } else if (s.build) {
        const ctx = normalizePath(composeDir, s.build);
        const match =
          components.find((c) => c.path === ctx) ??
          components.find(
            (c) => ctx !== '.' && (c.path.startsWith(`${ctx}/`) || ctx.startsWith(`${c.path}/`)),
          );
        if (match) serviceToComponent.set(s.name, match.id);
      }
    }
    for (const s of services) {
      const comp = components.find((c) => c.id === serviceToComponent.get(s.name));
      if (!comp) continue;
      comp.kind = 'app';
      for (const d of s.dependsOn) {
        const res = serviceToResource.get(d);
        if (res && !comp.uses.includes(res)) comp.uses.push(res);
        const other = serviceToComponent.get(d);
        if (other && other !== comp.id && !comp.dependsOn.includes(other))
          comp.dependsOn.push(other);
      }
      comp.uses.sort();
      comp.dependsOn.sort();
    }
  }

  components.sort((a, b) =>
    a.kind === b.kind ? a.path.localeCompare(b.path) : a.kind === 'app' ? -1 : 1,
  );
  return {
    name: snapshot.name,
    components,
    resources: Array.from(resources.values()).sort((a, b) => a.name.localeCompare(b.name)),
  };
}

function normalizePath(base: string, rel: string): string {
  const parts = (base === '.' ? [] : base.split('/')).concat(rel.split('/'));
  const out: string[] = [];
  for (const p of parts) {
    if (!p || p === '.') continue;
    if (p === '..') out.pop();
    else out.push(p);
  }
  return out.length ? out.join('/') : '.';
}
