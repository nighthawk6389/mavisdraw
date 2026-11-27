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

- A shape is a component once it has a label (unlabelled shapes and free text stay plain drawing).
  A labelled shape without a `componentId` is the component with its own element id, so existing
  maps need no backfill write: their shapes already have stable ids.
- Copying a shape to **another** diagram shows the same component there (the copy gets the source's
  component id; a portal copy opens into the same diagram); duplicating it **within** a diagram
  (paste, duplicate, Alt-drag) creates a new component, and a new portal starts empty. In other
  words: a component appears at most once per diagram. Cut and paste is a move, so it keeps its
  component.
- “Link to…” turns a shape into an appearance of a component from elsewhere (it takes that
  component's name); “Unlink” makes it its own component again.
- Same-named components on different diagrams are *offered* for linking (“Same thing? Link”),
  never merged automatically.

### In the editor

Selecting a component shows its panel at the top of the style column (its own column for viewers):
kind, name, where it appears (with a jump to each), description, technology, owner, links, code,
what it depends on and what uses it — rolled up through what's inside it — and known connections
not drawn on this diagram, with “Draw”. Editing a label on the canvas or in the portal panel renames
the component everywhere when it's drawn elsewhere or opens into a diagram. The panel refreshes from
the server when it opens (the model is computed from live rooms, so it's current), and on the
`model` signal.

## API

Everyone on a project can read its model. People who can edit the map can change it. Viewers get
403.

| Request | What it does |
| --- | --- |
| `GET /api/projects/:id/model` | The computed model: components (with appearances, containment, code and details) and relationships (drawn and recorded) |
| `POST /api/projects/:id/model/components` | Record a component nobody has drawn yet: `{ name, kind?, description?, technology?, owner?, tags?, links? }` |
| `PUT /api/projects/:id/model/components/:componentId` | Change details; a new `name` renames it everywhere (labels in live rooms and stored diagrams, and its detail diagram's title) |
| `DELETE /api/projects/:id/model/components/:componentId` | Forget its recorded details and recorded relationships (drawn shapes and arrows stay) |
| `PUT /api/projects/:id/model/relationships` | Record a relationship's details, or one nobody has drawn: `{ sourceId, targetId, description?, technology? }` |
| `DELETE /api/projects/:id/model/relationships?source=…&target=…` | Forget a recorded relationship |

Edits to diagrams nobody has open go through the stored CRDT state, so a room opened later keeps
them. Every change sends a `model` signal to the project's open rooms (and `diagrams` after a
rename).

## What it enables

- Rename once, everywhere — including the nested diagram’s title.
- “Appears in 3 diagrams”, with a jump to each.
- A component panel: kind, description, technology, owner, links, code, appearances, and its
  dependencies and dependents **across levels**, rolled up through containment.
- “Known connections not drawn here” when a component is placed on a diagram next to things it
  talks to elsewhere.
- Agents (MCP), PR checks and proposals work with component ids instead of matching text.
- Export of the model as Structurizr DSL (C4).

## Export: Structurizr DSL (C4)

Export → “Structurizr DSL — C4 model”, or `GET /api/projects/:id/model/structurizr`, writes the model
as a Structurizr workspace:
- top-level components become people and software systems;
- what's inside a system becomes its containers, and what's inside a container its components
  (deeper levels fold into their container);
- relationships keep their description and technology;
- kinds become tags (External, Database, Queue);
- views are generated for every level with something inside.

## Coding agents (MCP)

`get_component` gives a component by id, name or code path: its details, every diagram it's drawn
on, what it's part of and contains, and its dependencies and dependents across levels.
`find_component` and `read_architecture` show component ids, and `propose_update` accepts them. See
[mcp.md](mcp.md).

## Delivery

1. **Model core** (done): shared types; the model computed from elements and tables (pure,
   tested); tables and migration; model API; server-side rename propagation.
2. **Editor** (done): identity on paste and duplicate; rename from a label; the component panel;
   linking and unlinking; appearances and cross-level dependencies; suggested connections.
3. **Everything on ids** (done): MCP (component ids, `get_component`, dependencies across levels);
   Structurizr export.
   - Proposals (from agents and PR checks) are model-aware:
     - adding a component the map already has, by id or by a unique name drawn on another
       level, shows that same component here (and a system opens into its existing
       diagram);
     - connecting to a component drawn only elsewhere records the relationship in the model;
       if both ends are on the diagram by the time it's applied, it's drawn instead.
   - PR checks count a dependency as known when the model has it on any level, and record
     ones to components on other levels.
