/**
 * Starting points for a new map. Each is a Mermaid flowchart: subgraphs
 * become nested diagrams you can drill into, so a template opens as a real
 * multi-level architecture map, laid out, labelled and ready to edit.
 */

export interface Template {
  id: string;
  name: string;
  description: string;
  /** Short labels shown on the card. */
  tags: string[];
  mermaid: string;
}

const flow = (...lines: string[]) => ['flowchart LR', ...lines].join('\n');

export const TEMPLATES: Template[] = [
  {
    id: 'c4',
    name: 'C4: context → containers → components',
    description:
      'An online shop in the C4 style: people and outside systems around it, its containers one level in, and the API’s modules one level further.',
    tags: ['C4', '3 levels'],
    mermaid: flow(
      '  customer([Customer])',
      '  staff([Back-office staff])',
      '  subgraph shop [Online Shop]',
      '    web[Web App]',
      '    mobile[Mobile App]',
      '    subgraph api [API]',
      '      orders[Orders module] --> catalog[Catalog module]',
      '      orders --> checkout[Checkout module]',
      '    end',
      '    db[(Database)]',
      '    queue[[Message queue]]',
      '    worker[Worker]',
      '    web -->|JSON/HTTPS| api',
      '    mobile -->|JSON/HTTPS| api',
      '    api -->|SQL| db',
      '    api -->|publishes| queue',
      '    worker -->|consumes| queue',
      '  end',
      '  payments[Payment provider]',
      '  email[Email service]',
      '  customer -->|browses, buys| web',
      '  customer -->|uses| mobile',
      '  staff -->|manages orders| web',
      '  checkout -->|charges cards| payments',
      '  worker -->|sends receipts| email',
    ),
  },
  {
    id: 'microservices',
    name: 'Microservices',
    description:
      'A gateway in front of services that each own their data, talking over REST, gRPC and an event bus — each service drills into its own internals.',
    tags: ['Services', 'Events'],
    mermaid: flow(
      '  clients([Web & mobile clients])',
      '  gateway[API Gateway]',
      '  auth[Auth service]',
      '  subgraph orders_svc [Orders service]',
      '    orders_api[Orders API] --> orders_db[(Orders DB)]',
      '  end',
      '  subgraph catalog_svc [Catalog service]',
      '    catalog_api[Catalog API] --> catalog_db[(Catalog DB)]',
      '    catalog_api --> search[(Search index)]',
      '  end',
      '  subgraph payments_svc [Payments service]',
      '    payments_api[Payments API] --> payments_db[(Payments DB)]',
      '  end',
      '  bus[[Event bus]]',
      '  notifications[Notifications service]',
      '  clients -->|HTTPS| gateway',
      '  gateway -->|verifies tokens| auth',
      '  gateway -->|REST| orders_svc',
      '  gateway -->|REST| catalog_svc',
      '  orders_svc -->|gRPC| payments_svc',
      '  orders_svc -->|OrderPlaced| bus',
      '  bus -->|OrderPlaced| notifications',
    ),
  },
  {
    id: 'aws-web-app',
    name: 'AWS web application',
    description:
      'A classic three-tier app on AWS: DNS and CDN at the edge, a load-balanced service in a VPC, and a managed database with a replica.',
    tags: ['AWS', 'Three-tier'],
    mermaid: flow(
      '  users([Users])',
      '  dns[Route 53]',
      '  cdn[CloudFront]',
      '  assets[(S3: static assets)]',
      '  subgraph vpc [VPC]',
      '    alb[Application Load Balancer]',
      '    subgraph app_tier [App tier]',
      '      ecs[ECS service] --> cache[(ElastiCache Redis)]',
      '    end',
      '    subgraph data_tier [Data tier]',
      '      primary[(RDS Postgres)] -->|replicates| replica[(Read replica)]',
      '    end',
      '    alb --> app_tier',
      '    app_tier -->|SQL| data_tier',
      '  end',
      '  logs[CloudWatch]',
      '  users -->|HTTPS| dns',
      '  dns --> cdn',
      '  cdn -->|static| assets',
      '  cdn -->|dynamic| vpc',
      '  vpc -->|logs & metrics| logs',
    ),
  },
  {
    id: 'event-driven',
    name: 'Event-driven system',
    description:
      'Producers publish to Kafka topics, consumers react; drill into each group to see who publishes and subscribes to what, including the dead-letter topic.',
    tags: ['Kafka', 'Async'],
    mermaid: flow(
      '  subgraph producers [Producers]',
      '    checkout[Checkout]',
      '    inventory[Inventory]',
      '  end',
      '  subgraph kafka [Kafka]',
      '    orders_topic[[orders]]',
      '    stock_topic[[stock-levels]]',
      '    dlq[[dead-letter]]',
      '  end',
      '  subgraph consumers [Consumers]',
      '    fulfilment[Fulfilment]',
      '    analytics[Analytics]',
      '    notifier[Notifier]',
      '  end',
      '  checkout -->|OrderPlaced| orders_topic',
      '  inventory -->|StockChanged| stock_topic',
      '  orders_topic --> fulfilment',
      '  orders_topic --> analytics',
      '  stock_topic --> analytics',
      '  orders_topic --> notifier',
      '  notifier -->|failed deliveries| dlq',
    ),
  },
  {
    id: 'data-pipeline',
    name: 'Data pipeline',
    description:
      'From operational sources through ingestion into a warehouse, then out to dashboards and ML — each stage drills into its tools.',
    tags: ['Analytics', 'ELT'],
    mermaid: flow(
      '  subgraph sources [Sources]',
      '    app_db[(App database)]',
      '    events[Product events]',
      '    saas[SaaS APIs]',
      '  end',
      '  subgraph ingestion [Ingestion]',
      '    cdc[CDC connector] --> lake[(Data lake)]',
      '    collector[Event collector] --> lake',
      '    elt[Scheduled ELT] --> lake',
      '  end',
      '  subgraph warehouse [Warehouse]',
      '    staging[(Staging)] -->|dbt models| marts[(Marts)]',
      '  end',
      '  bi[BI dashboards]',
      '  ml[ML features]',
      '  sources --> ingestion',
      '  ingestion --> warehouse',
      '  warehouse --> bi',
      '  warehouse --> ml',
    ),
  },
  {
    id: 'saas',
    name: 'SaaS platform',
    description:
      'A typical product: web and mobile apps, an API with its database, cache and background jobs, and the SaaS it leans on for auth, billing, email and errors.',
    tags: ['Startup', 'Overview'],
    mermaid: flow(
      '  customers([Customers])',
      '  web[Web app]',
      '  mobile[Mobile app]',
      '  subgraph platform [Platform]',
      '    api[API] --> db[(Postgres)]',
      '    api --> cache[(Redis)]',
      '    api -->|enqueues| jobs[Background jobs]',
      '    jobs --> db',
      '  end',
      '  idp[Auth0]',
      '  stripe[Stripe]',
      '  sendgrid[SendGrid]',
      '  sentry[Sentry]',
      '  customers --> web',
      '  customers --> mobile',
      '  web -->|HTTPS| platform',
      '  mobile -->|HTTPS| platform',
      '  platform -->|sign-in| idp',
      '  platform -->|billing| stripe',
      '  platform -->|email| sendgrid',
      '  platform -->|errors| sentry',
    ),
  },
];

/** The template behind "Explore a sample" for new users. */
export const SAMPLE_TEMPLATE_ID = 'c4';

export function findTemplate(id: string | null | undefined): Template | undefined {
  return TEMPLATES.find((t) => t.id === id);
}
