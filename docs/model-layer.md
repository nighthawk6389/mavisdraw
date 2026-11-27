# The architecture model

Until now a MavisDraw map was a set of drawings: a box labelled “Postgres” on one diagram and a box
labelled “Postgres” on another were unrelated shapes, renaming a system didn’t rename the diagram it
opens into, and a dependency existed only as an arrow on one diagram. Agents, PR checks and proposals
matched components by their label text.

The model layer makes the map a model with views — the approach of C4/Structurizr, IcePanel and
Ilograph — without giving up the whiteboard.

## Concepts

- **Component** — a thing in the architecture: a service, datastore, queue, external system, a
  system with its own nested diagram, or a person. It has an id, a name, a kind, and optional
  description, technology, owner, tags, links, and the code it stands for (repository folder).
- **Appearance** — a shape on a diagram that shows a component. A component can appear on many
  diagrams (at most once per diagram). Shapes carry the component’s id (`componentId`).
- **Detail diagram** — the nested diagram a component opens into (its portal’s target). Components
  on a component’s detail diagram are *inside* it: that containment is what lets dependencies roll
  up across levels (“the Online Shop uses Stripe” because its API does).
- **Relationship** — “A depends on / talks to B”. Drawn as an arrow between two appearances on any
  diagram; one relationship can be drawn on several diagrams. It can carry a description and a
  technology (“REST”, “gRPC”, “publishes OrderPlaced”). Relationships can also exist without being
  drawn (recorded by an agent, a PR check or the component panel) — they show as “not drawn here”.

## How it is stored

Identity rides on the elements; metadata lives in two tables.

| What | Where | Why |
| --- | --- | --- |
| `componentId` on shapes | element JSON (synced live through Y.js, journaled offline) | identity travels with the drawing: offline edits, undo, copy/paste and version history keep working unchanged |
| Name | the shape’s label (bound text / portal label) on every appearance — **materialized** | exports, embeds, README images, search, comments, MCP and PR checks read labels; they all stay correct without a lookup |
| Description, kind, technology, owner, tags, links | `model_components` table | rich metadata, edited in the component panel or by agents; not needed to draw |
| Relationship metadata, model-only relationships | `model_relationships` table, keyed by (source, target) | drawn relationships are derived from arrows; the row adds what the arrow can’t say, or records one nobody has drawn yet |

The **project model** is computed by the server from both: every diagram’s elements (live room state
first) plus the two tables.

- A component exists if it appears on a diagram or has a row (a “model-only” component).
- Its name is the label of its appearances (the row keeps the last known name, for model-only ones).
- A relationship exists if an arrow joins two of its components’ appearances, or it has a row.

### Renaming

Renaming a component (in its panel, by editing any of its labels, or through the API) renames it
everywhere: the server rewrites the label of every appearance — in open live rooms (so everyone sees
it at once) and in stored diagrams — and the title of its detail diagram. Element versions are bumped
like any edit, so offline copies and REST saves resolve against it normally.

### Identity rules in the editor

- A shape gets a component when it gets a label (unlabelled shapes and free text stay plain drawing).
- Copying a shape to **another** diagram shows the same component there; duplicating it **within**
  a diagram (paste, duplicate) creates a new component. In other words: a component appears at most
  once per diagram, and a second copy on the same diagram becomes its own component.
- “Link to an existing component” turns a shape into an appearance of a component from elsewhere;
  “Unlink” makes it its own component again.
- Existing maps: shapes get ids the first time an editor opens their diagram. Same-named components
  on different diagrams are *offered* for linking, never merged automatically.

## What it enables

- Rename once, everywhere — including the nested diagram’s title.
- “Appears in 3 diagrams”, with a jump to each.
- A component panel: kind, description, technology, owner, links, code, appearances, and its
  dependencies and dependents **across levels**, rolled up through containment.
- “Known connections not drawn here” when a component is placed on a diagram next to things it
  talks to elsewhere.
- Agents (MCP), PR checks and proposals work with component ids instead of matching text.
- Export of the model as Structurizr DSL (C4).

## Delivery

1. **Model core** — shared types, the model computed from elements + tables (pure, tested), tables
   and migration, model API, server-side rename propagation.
2. **Editor** — identity assignment (labels, paste, duplicate), rename-from-label, component panel,
   linking/unlinking, appearances and cross-level dependencies, suggestions of connections, legacy
   backfill.
3. **Everything on ids** — MCP (component ids, `get_component`, dependencies), PR checks and
   proposals, Structurizr export, docs.
