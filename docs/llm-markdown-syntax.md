# MavisDraw LLM-Readable Markdown Syntax

This document defines the structured Markdown format that MavisDraw uses to represent architecture diagrams. The format is designed to be both human-readable and LLM-parseable, focusing on **topology only** — element names, types, connections, and code links. No coordinates, sizes, or styling.

## Quick Example

```markdown
# Architecture: My System

### Elements

- [rectangle] "API Gateway" → connected to "Auth Service", "User Service"
- [rectangle] "Auth Service"
- [portal] "User Service" → drills into "User Service Detail"
  - github: acme/user-service @ src/
- [ellipse] "Cache"

### Connections

- "API Gateway" -->[REST] "Auth Service"
- "API Gateway" -->[gRPC] "User Service"
- "Auth Service" --> "Cache"

## User Service Detail

### Elements

- [rectangle] "UserController" → connected to "UserRepository"
- [rectangle] "UserRepository"
- [diamond] "Rate Limiter"

### Connections

- "UserController" --> "UserRepository"
- "Rate Limiter" --> "UserController"
```

## Syntax Reference

### Root Header (required)

```
# Architecture: {project name}
```

The top-level heading identifies the project. Everything below belongs to the root diagram.

### Diagram Sections

Nested diagrams (linked via portals) use headings level 2+:

```
## {Diagram Title}
### {Nested Diagram Title}
#### {Deeply Nested Diagram Title}
```

Heading depth determines the nesting hierarchy. Headings titled `Elements` or `Connections` are reserved section markers and are not treated as diagram names.

### Elements Section

```
### Elements
```

This sub-heading marks the start of the element list for the current diagram.

#### Shape Elements

```
- [{type}] "{label}"
- [{type}] "{label}" → connected to "{target1}", "{target2}"
```

**Supported types**: `rectangle`, `ellipse`, `diamond`, `triangle`

| Part | Required | Description |
|------|----------|-------------|
| `[{type}]` | Yes | Element type in square brackets |
| `"{label}"` | Yes | Element name in double quotes |
| `→ connected to ...` | No | Inline hint listing outgoing connections. Informational — the `Connections` section is authoritative. |

#### Portal Elements

Portals represent drill-down sub-diagrams and/or links to GitHub repositories:

```
- [portal] "{label}"
- [portal] "{label}" → drills into "{Nested Diagram Title}"
  - github: {owner}/{repo} @ {path} ({ref})
```

| Part | Required | Description |
|------|----------|-------------|
| `"{label}"` | Yes | Portal display name |
| `→ drills into "{title}"` | No | Links to a nested diagram section (matched by title) |
| `github: ...` | No | Links to a GitHub repository (see below) |

A portal can have both a nested diagram link and a GitHub link simultaneously.

### GitHub Links

GitHub links appear as indented sub-items under portal elements:

```
  - github: {owner}/{repo}
  - github: {owner}/{repo} @ {path}
  - github: {owner}/{repo} @ {path} ({ref})
```

| Part | Required | Default | Description |
|------|----------|---------|-------------|
| `{owner}/{repo}` | Yes | — | GitHub repository (e.g., `acme/api-gateway`) |
| `@ {path}` | No | `""` (repo root) | File or directory path (e.g., `src/controllers/`) |
| `({ref})` | No | `main` | Branch or tag. Omitted when `main` or `HEAD` on serialization. |

**Examples:**
```
  - github: acme/user-service
  - github: acme/user-service @ src/
  - github: acme/user-service @ src/controllers/UserController.ts (develop)
```

### Connections Section

```
### Connections
```

This sub-heading marks the start of the connection list.

#### Arrow Connections

```
- "{from}" --> "{to}"
- "{from}" -->[{label}] "{to}"
```

| Part | Required | Description |
|------|----------|-------------|
| `"{from}"` | Yes | Source element label (must match an element in the Elements section) |
| `-->` | Yes | Directed arrow (creates an arrow element with arrowhead) |
| `[{label}]` | No | Connection label in square brackets (e.g., `[REST]`, `[gRPC]`, `[HTTP/2]`) |
| `"{to}"` | Yes | Target element label |

#### Line Connections

```
- "{from}" --- "{to}"
- "{from}" ---[{label}] "{to}"
```

Same as arrows but uses `---` for undirected lines (no arrowhead).

### Complete Grammar (EBNF-like)

```
document        = root-header , { blank-line } , diagram-body , { nested-diagram }
root-header     = "# Architecture: " , text , newline
nested-diagram  = heading , { blank-line } , diagram-body

diagram-body    = [ elements-section ] , [ connections-section ]

elements-section    = elements-heading , { blank-line } , { element-line }
connections-section = connections-heading , { blank-line } , { connection-line }

elements-heading    = heading-prefix , " Elements" , newline
connections-heading = heading-prefix , " Connections" , newline

heading         = heading-prefix , " " , text , newline
heading-prefix  = "##" | "###" | "####" | "#####" | "######"

element-line    = "- [" , type , "] \"" , label , "\"" , [ connection-hint ] , newline , [ github-line ]
type            = "rectangle" | "ellipse" | "diamond" | "triangle" | "portal"
label           = text  (* no double quotes *)
connection-hint = " → connected to " , label-list
                | " → drills into \"" , text , "\""
label-list      = "\"" , label , "\"" , { ", \"" , label , "\"" }

github-line     = "  - github: " , owner , "/" , repo , [ " @ " , path ] , [ " (" , ref , ")" ] , newline

connection-line = "- \"" , label , "\" " , arrow , [ "[" , text , "]" ] , " \"" , label , "\"" , newline
arrow           = "-->" | "---"

text            = { any character except newline }
owner           = { alphanumeric | "-" | "_" }
repo            = { alphanumeric | "-" | "_" | "." }
path            = { any character except whitespace and "(" }
ref             = { any character except ")" }
blank-line      = newline
```

## Serialization Rules

When MavisDraw **exports** a diagram to this format:

1. **Deleted elements are excluded** — elements with `isDeleted: true` are omitted.
2. **Element labels come from bound text** — shapes use the text of their bound text element. Falls back to `{type}_{id}` if no text.
3. **Portal labels use the portal's label property**.
4. **GitHub refs `main` and `HEAD` are omitted** for brevity.
5. **Only bound connections are listed** — arrows must have both `startBinding` and `endBinding` to appear in the Connections section.
6. **Nested diagrams are rendered recursively** — portals with `targetDiagramId` trigger rendering of the child diagram as a sub-section.
7. **Freedraw elements are excluded** — hand-drawn paths don't have meaningful topology.
8. **Arrow labels use bracket syntax** — `-->[REST]` rather than a separate line.
9. **The `→ connected to` hint on element lines is informational** — it summarizes outgoing connections but the Connections section is the source of truth.

## Deserialization Rules

When MavisDraw **imports** from this format:

1. **All shape types are created as rectangles** — the type hint is preserved in metadata but visual type isn't differentiated yet during import.
2. **Elements are auto-laid out in a 4-column grid** — 250px horizontal spacing, 150px vertical spacing, starting at (100, 100).
3. **Connection labels create bound text elements** on the arrow.
4. **Portal `→ drills into` creates a link** to the matching nested diagram section by title.
5. **Unresolved labels in connections are silently skipped** — if a connection references a label that doesn't exist in the Elements section, the arrow is not created.
6. **The parser is line-based and lenient** — blank lines, extra whitespace, and minor formatting variations are tolerated.

## Use Cases

- **LLM diagram generation**: An AI agent can produce this Markdown to create architecture diagrams.
- **LLM diagram understanding**: Export existing diagrams for AI analysis of architecture topology.
- **Version-control-friendly**: Plain text format that diffs well in Git.
- **Agentic workflows**: An AI agent reads this format, understands the architecture, browses linked GitHub repos, and suggests modifications — all without needing pixel-level diagram data.

## AI Chat Integration

The built-in AI Chat panel (see `docs/github-llm-integration.md`) uses this format as the bridge between the visual canvas and the AI agent:

1. **On every chat request**, the frontend serializes the current diagram to this Markdown via `serializeScene()` and sends it as `diagramMarkdown` in the request body.
2. **The system prompt** includes the full Markdown so the agent can see the current architecture.
3. **The agent's `browse_diagram` tool** returns this same Markdown, letting the agent re-read it during multi-step tool use.
4. **The agent proposes changes** using element labels from this format — e.g., `"Add a rectangle labeled 'Database' connected to 'API Gateway'"` maps to the labels in the `### Elements` section.

This means the Markdown syntax is not just an export format — it is the live representation of the diagram that the AI operates on.
