import type { ModelComponentKind } from '@mavisdraw/types';
import { ICONS, type IconDefinition } from './iconData.js';

/**
 * Architecture shapes and icons, shared by the editor's canvas, SVG exports,
 * embeds and the server (proposals, PR checks), so a datastore looks like a
 * datastore everywhere.
 */

export { ICONS, type IconDefinition };

// ── Icons ────────────────────────────────────────────────────

/** An icon by id (own entries only: never a prototype property). */
export function iconById(id: unknown): IconDefinition | null {
  if (typeof id !== 'string' || !Object.prototype.hasOwnProperty.call(ICONS, id)) return null;
  return ICONS[id];
}

/** Where an icon sits inside a shape, in the shape's own coordinates. */
export function iconPlacement(el: {
  type: string;
  width: number;
  height: number;
}): { x: number; y: number; size: number } | null {
  const w = Math.abs(el.width);
  const h = Math.abs(el.height);
  if (w < 24 || h < 24) return null;
  const size = Math.round(Math.max(14, Math.min(28, Math.min(w, h) * 0.28)));
  const pad = Math.round(Math.max(6, size * 0.35));
  switch (el.type) {
    case 'ellipse':
      return { x: (w - size) / 2, y: h * 0.12, size };
    case 'diamond':
      return { x: (w - size) / 2, y: h * 0.2, size };
    case 'cylinder': {
      // On the lid, clear of the label in the middle
      const { ry } = cylinderPaths(w, h);
      const lid = Math.round(Math.max(12, Math.min(22, ry * 1.5)));
      return { x: (w - lid) / 2, y: ry - lid / 2, size: lid };
    }
    case 'queue':
      return { x: queuePaths(w, h).rx + pad / 2, y: pad, size };
    default:
      return { x: pad, y: pad, size };
  }
}

// ── Shapes with curved ends ──────────────────────────────────

/**
 * A cylinder (datastore) as SVG path data: the outline to fill and stroke,
 * and the front of the top rim, stroked over it.
 */
export function cylinderPaths(w: number, h: number): { body: string; rim: string; ry: number } {
  const ry = Math.max(2, Math.min(h * 0.12, w * 0.25, 18));
  const rx = w / 2;
  const body = `M 0 ${ry} L 0 ${h - ry} A ${rx} ${ry} 0 0 0 ${w} ${h - ry} L ${w} ${ry} A ${rx} ${ry} 0 0 0 0 ${ry} Z`;
  const rim = `M 0 ${ry} A ${rx} ${ry} 0 0 0 ${w} ${ry}`;
  return { body, rim, ry };
}

/**
 * A queue (a cylinder on its side) as SVG path data: the outline, and the
 * visible face of its right end.
 */
export function queuePaths(w: number, h: number): { body: string; rim: string; rx: number } {
  const rx = Math.max(2, Math.min(w * 0.12, h * 0.25, 18));
  const ry = h / 2;
  const body = `M ${rx} 0 L ${w - rx} 0 A ${rx} ${ry} 0 0 1 ${w - rx} ${h} L ${rx} ${h} A ${rx} ${ry} 0 0 1 ${rx} 0 Z`;
  const rim = `M ${w - rx} 0 A ${rx} ${ry} 0 0 0 ${w - rx} ${h}`;
  return { body, rim, rx };
}

// ── The catalog ──────────────────────────────────────────────

export type Provider = 'generic' | 'aws' | 'gcp' | 'azure' | 'kubernetes';

export const PROVIDERS: Record<Provider, { label: string; color: string }> = {
  generic: { label: 'Generic', color: '#1e1e1e' },
  aws: { label: 'AWS', color: '#c2410c' },
  gcp: { label: 'Google Cloud', color: '#1d4ed8' },
  azure: { label: 'Azure', color: '#0369a1' },
  kubernetes: { label: 'Kubernetes', color: '#3150b8' },
};

export type LibraryShape = 'rectangle' | 'cylinder' | 'queue';

export interface CatalogEntry {
  /** Stable id, e.g. "aws-s3". */
  id: string;
  provider: Provider;
  /** Shown in the library and used as the new shape's label. */
  name: string;
  shape: LibraryShape;
  icon: string;
  kind: ModelComponentKind;
  /** Other names for it (technologies, products) for search and repo maps. */
  keywords: string[];
}

type Row = [
  name: string,
  shape: LibraryShape,
  icon: string,
  kind: ModelComponentKind,
  keywords?: string,
];

const ROWS: Record<Provider, Row[]> = {
  generic: [
    // Not "api": too common in names ("Anthropic API") to mean a generic service
    ['Service', 'rectangle', 'server', 'service', 'backend microservice'],
    [
      'Web app',
      'rectangle',
      'app-window',
      'service',
      'frontend web spa react next vue angular svelte',
    ],
    ['Mobile app', 'rectangle', 'smartphone', 'service', 'ios android react-native flutter'],
    ['Browser', 'rectangle', 'monitor', 'person', 'client desktop'],
    ['User', 'rectangle', 'user', 'person', 'customer person actor'],
    ['Users', 'rectangle', 'users', 'person', 'customers team people'],
    [
      'Database',
      'cylinder',
      'database',
      'datastore',
      'postgres postgresql mysql mariadb sql sqlite mongodb mongo mssql oracle cockroachdb neon supabase planetscale',
    ],
    ['Cache', 'cylinder', 'memory-stick', 'datastore', 'redis memcached valkey keydb dragonfly'],
    [
      'Search index',
      'cylinder',
      'search',
      'datastore',
      'elasticsearch opensearch meilisearch typesense solr algolia',
    ],
    [
      'Data warehouse',
      'cylinder',
      'warehouse',
      'datastore',
      'snowflake bigquery redshift clickhouse databricks',
    ],
    ['Object storage', 'rectangle', 'archive', 'datastore', 's3 gcs blob minio r2 bucket storage'],
    [
      'Queue',
      'queue',
      'list-ordered',
      'queue',
      'rabbitmq amqp sqs celery bullmq sidekiq nats activemq',
    ],
    ['Event stream', 'queue', 'radio', 'queue', 'kafka kinesis pulsar redpanda event-hubs'],
    ['Function', 'rectangle', 'zap', 'service', 'lambda serverless faas'],
    ['Worker', 'rectangle', 'cog', 'service', 'job background consumer'],
    ['Scheduler', 'rectangle', 'calendar-clock', 'service', 'cron scheduled'],
    ['Load balancer', 'rectangle', 'split', 'service', 'nginx haproxy envoy traefik'],
    ['CDN', 'rectangle', 'globe', 'external', 'cloudflare fastly akamai'],
    ['API gateway', 'rectangle', 'arrow-right-left', 'service', 'kong apigee tyk'],
    [
      'Identity provider',
      'rectangle',
      'fingerprint',
      'external',
      'auth0 okta keycloak clerk sso oidc auth',
    ],
    ['Payments', 'rectangle', 'credit-card', 'external', 'stripe paypal braintree adyen'],
    ['Email', 'rectangle', 'mail', 'external', 'sendgrid mailgun postmark resend smtp'],
    ['Notifications', 'rectangle', 'bell', 'external', 'twilio sms push onesignal pusher'],
    [
      'Monitoring',
      'rectangle',
      'activity',
      'external',
      'datadog sentry prometheus grafana newrelic opentelemetry',
    ],
    ['Analytics', 'rectangle', 'chart-column', 'external', 'segment mixpanel amplitude posthog'],
    [
      'AI model',
      'rectangle',
      'brain-circuit',
      'external',
      'openai anthropic claude gemini llm huggingface',
    ],
    ['AI agent', 'rectangle', 'bot', 'service', 'agent assistant'],
    ['Secrets', 'rectangle', 'key', 'datastore', 'vault secrets'],
    ['Container', 'rectangle', 'container', 'service', 'docker'],
    ['Webhook', 'rectangle', 'webhook', 'external', 'callback'],
  ],
  aws: [
    ['EC2', 'rectangle', 'server', 'service', 'instance vm'],
    ['Lambda', 'rectangle', 'zap', 'service', 'function serverless'],
    ['ECS', 'rectangle', 'container', 'service', 'container fargate'],
    ['EKS', 'rectangle', 'boxes', 'system', 'kubernetes cluster'],
    ['S3', 'rectangle', 'archive', 'datastore', 'bucket object storage'],
    ['RDS', 'cylinder', 'database', 'datastore', 'postgres mysql database'],
    ['Aurora', 'cylinder', 'database', 'datastore', 'database'],
    ['DynamoDB', 'cylinder', 'database', 'datastore', 'nosql database'],
    ['ElastiCache', 'cylinder', 'memory-stick', 'datastore', 'redis memcached cache'],
    ['SQS', 'queue', 'list-ordered', 'queue', 'queue'],
    ['SNS', 'rectangle', 'radio', 'queue', 'topic pubsub notifications'],
    ['EventBridge', 'rectangle', 'share-2', 'queue', 'events bus'],
    ['Kinesis', 'queue', 'radio', 'queue', 'stream'],
    ['API Gateway', 'rectangle', 'arrow-right-left', 'service', 'api'],
    ['CloudFront', 'rectangle', 'globe', 'service', 'cdn'],
    ['Load Balancer', 'rectangle', 'split', 'service', 'elb alb nlb'],
    ['Route 53', 'rectangle', 'earth', 'service', 'dns'],
    ['Cognito', 'rectangle', 'fingerprint', 'service', 'auth identity'],
    ['Step Functions', 'rectangle', 'workflow', 'service', 'workflow orchestration'],
    ['CloudWatch', 'rectangle', 'activity', 'service', 'monitoring logs'],
    ['Redshift', 'cylinder', 'warehouse', 'datastore', 'warehouse'],
    ['Secrets Manager', 'rectangle', 'key', 'datastore', 'secrets'],
    ['SES', 'rectangle', 'mail', 'service', 'email'],
    ['Bedrock', 'rectangle', 'brain-circuit', 'service', 'ai llm model'],
  ],
  gcp: [
    ['Compute Engine', 'rectangle', 'server', 'service', 'vm instance'],
    ['Cloud Run', 'rectangle', 'container', 'service', 'container serverless'],
    ['Cloud Functions', 'rectangle', 'zap', 'service', 'function serverless'],
    ['GKE', 'rectangle', 'boxes', 'system', 'kubernetes cluster'],
    ['App Engine', 'rectangle', 'app-window', 'service', 'app'],
    ['Cloud Storage', 'rectangle', 'archive', 'datastore', 'gcs bucket object storage'],
    ['Cloud SQL', 'cylinder', 'database', 'datastore', 'postgres mysql database'],
    ['Firestore', 'cylinder', 'database', 'datastore', 'nosql database firebase'],
    ['Spanner', 'cylinder', 'database', 'datastore', 'database'],
    ['Bigtable', 'cylinder', 'database', 'datastore', 'database'],
    ['Memorystore', 'cylinder', 'memory-stick', 'datastore', 'redis cache'],
    ['BigQuery', 'cylinder', 'warehouse', 'datastore', 'warehouse analytics'],
    ['Pub/Sub', 'queue', 'radio', 'queue', 'pubsub topic stream'],
    ['Cloud Tasks', 'queue', 'list-ordered', 'queue', 'queue tasks'],
    ['Load Balancing', 'rectangle', 'split', 'service', 'load balancer'],
    ['Cloud CDN', 'rectangle', 'globe', 'service', 'cdn'],
    ['API Gateway', 'rectangle', 'arrow-right-left', 'service', 'api'],
    ['Cloud Scheduler', 'rectangle', 'calendar-clock', 'service', 'cron'],
    ['Vertex AI', 'rectangle', 'brain-circuit', 'service', 'ai ml gemini'],
    ['Secret Manager', 'rectangle', 'key', 'datastore', 'secrets'],
    ['Identity Platform', 'rectangle', 'fingerprint', 'service', 'auth identity'],
  ],
  azure: [
    ['Virtual Machines', 'rectangle', 'server', 'service', 'vm'],
    ['App Service', 'rectangle', 'app-window', 'service', 'web app'],
    ['Functions', 'rectangle', 'zap', 'service', 'function serverless'],
    ['AKS', 'rectangle', 'boxes', 'system', 'kubernetes cluster'],
    ['Container Apps', 'rectangle', 'container', 'service', 'container'],
    ['Blob Storage', 'rectangle', 'archive', 'datastore', 'blob object storage'],
    ['SQL Database', 'cylinder', 'database', 'datastore', 'sql server database'],
    ['Cosmos DB', 'cylinder', 'database', 'datastore', 'nosql database'],
    ['Cache for Redis', 'cylinder', 'memory-stick', 'datastore', 'redis cache'],
    ['Service Bus', 'queue', 'list-ordered', 'queue', 'queue'],
    ['Event Hubs', 'queue', 'radio', 'queue', 'stream events'],
    ['Event Grid', 'rectangle', 'share-2', 'queue', 'events'],
    ['API Management', 'rectangle', 'arrow-right-left', 'service', 'api gateway'],
    ['Front Door', 'rectangle', 'globe', 'service', 'cdn'],
    ['Application Gateway', 'rectangle', 'split', 'service', 'load balancer'],
    ['Entra ID', 'rectangle', 'fingerprint', 'service', 'active directory identity auth'],
    ['Key Vault', 'rectangle', 'key', 'datastore', 'secrets'],
    ['Monitor', 'rectangle', 'activity', 'service', 'monitoring'],
    ['OpenAI', 'rectangle', 'brain-circuit', 'service', 'ai llm'],
    ['Synapse', 'cylinder', 'warehouse', 'datastore', 'warehouse analytics'],
  ],
  kubernetes: [
    ['Cluster', 'rectangle', 'boxes', 'system', 'k8s'],
    ['Node', 'rectangle', 'server', 'service', 'machine'],
    ['Namespace', 'rectangle', 'folder', 'system', ''],
    ['Pod', 'rectangle', 'box', 'service', ''],
    ['Deployment', 'rectangle', 'layers', 'service', 'replicaset'],
    ['StatefulSet', 'rectangle', 'layers', 'service', ''],
    ['DaemonSet', 'rectangle', 'layers', 'service', ''],
    ['Service', 'rectangle', 'network', 'service', 'svc'],
    ['Ingress', 'rectangle', 'split', 'service', 'gateway'],
    ['ConfigMap', 'rectangle', 'file-text', 'datastore', 'config'],
    ['Secret', 'rectangle', 'key', 'datastore', 'secrets'],
    ['Persistent Volume', 'cylinder', 'hard-drive', 'datastore', 'pv pvc volume storage'],
    ['Job', 'rectangle', 'cog', 'service', ''],
    ['CronJob', 'rectangle', 'calendar-clock', 'service', 'cron'],
    ['Autoscaler', 'rectangle', 'gauge', 'service', 'hpa'],
  ],
};

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

export const CATALOG: CatalogEntry[] = (Object.keys(ROWS) as Provider[]).flatMap((provider) =>
  ROWS[provider].map(([name, shape, icon, kind, keywords]) => ({
    id: `${provider}-${slug(name)}`,
    provider,
    name,
    shape,
    icon,
    kind,
    keywords: (keywords ?? '').split(/\s+/).filter(Boolean),
  })),
);

const normalize = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

/** Entries matching a search, best first (all of them for an empty query). */
export function searchCatalog(query: string): CatalogEntry[] {
  const q = normalize(query);
  if (!q) return CATALOG;
  const words = q.split(' ');
  const scored: Array<{ entry: CatalogEntry; score: number }> = [];
  for (const entry of CATALOG) {
    const name = normalize(entry.name);
    const provider = normalize(PROVIDERS[entry.provider].label);
    const haystack = [name, provider, entry.provider, ...entry.keywords.map(normalize)];
    let score = 0;
    for (const word of words) {
      if (name === word || entry.keywords.includes(word)) score += 3;
      else if (haystack.some((h) => h.split(' ').some((part) => part.startsWith(word)))) score += 1;
      else {
        score = 0;
        break;
      }
    }
    if (name === q) score += 5;
    if (score > 0) scored.push({ entry, score });
  }
  return scored.sort((a, b) => b.score - a.score).map((s) => s.entry);
}

/**
 * The entry for a technology or product name ("PostgreSQL", "redis",
 * "Stripe", "aws s3"), used to draw repo maps and proposals with the right
 * shape and icon. Generic entries win unless a provider is named.
 */
export function catalogFor(name: string): CatalogEntry | null {
  const q = normalize(name);
  if (!q) return null;
  const words = q.split(' ');
  const named = (Object.keys(PROVIDERS) as Provider[]).find(
    (p) => p !== 'generic' && (words.includes(p) || q.includes(normalize(PROVIDERS[p].label))),
  );
  const pool = CATALOG.filter((e) => (named ? e.provider === named : e.provider === 'generic'));
  const matches = (e: CatalogEntry) =>
    words.some((w) => e.keywords.includes(w)) ||
    words.includes(normalize(e.name)) ||
    q.includes(normalize(e.name));
  return pool.find((e) => normalize(e.name) === q) ?? pool.find(matches) ?? null;
}
