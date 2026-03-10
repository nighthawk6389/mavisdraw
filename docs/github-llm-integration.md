# GitHub Integration, LLM-Readable Format & AI Chat

This document describes how MavisDraw connects to GitHub repositories, how the LLM-readable export format works, and how the AI Chat interface lets an agent understand, create, and modify diagrams.

## Architecture

```
┌─────────────────────────────────────────────────────┐
│  Frontend (apps/web)                                │
│  ┌─────────────┐  ┌──────────────┐  ┌───────────┐  │
│  │ GitHubStore  │  │ RepoBrowser  │  │ Portal    │  │
│  │ (Zustand)    │  │ Component    │  │ Properties│  │
│  └──────┬───────┘  └──────┬───────┘  └─────┬─────┘  │
│         │                 │                │        │
│  ┌──────┴─────────────────┴────────────────┘        │
│  │ services/github.ts (API client)                  │
│  └──────────────────────┬───────────────────────────┘
│                         │
├─────────────────────────┼───────────────────────────┤
│  Backend (apps/server)  │                           │
│  ┌──────────────────────┴──────────────────────┐    │
│  │ routes/github.ts (Fastify plugin)           │    │
│  └──────────────────────┬──────────────────────┘    │
│  ┌──────────────────────┴──────────────────────┐    │
│  │ services/githubService.ts                   │    │
│  │  - OAuth flow                               │    │
│  │  - GitHub REST API proxy                    │    │
│  │  - Connection management (DB)               │    │
│  └──────────────────────┬──────────────────────┘    │
│  ┌──────────────────────┴──────────────────────┐    │
│  │ utils/encryption.ts (AES-256-GCM)           │    │
│  └─────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────┘
```

## GitHub Integration

### Data Model

A portal element can now optionally carry a `githubLink`:

```typescript
interface GitHubLink {
  owner: string;       // e.g. "acme"
  repo: string;        // e.g. "api-gateway"
  path: string;        // e.g. "src/controllers/" or "" for root
  ref: string;         // branch/tag, e.g. "main"
  enterpriseUrl?: string; // null = github.com
}

interface PortalElement extends BaseElement {
  type: 'portal';
  targetDiagramId: string;
  label: string;
  thumbnailDataUrl: string | null;
  portalStyle: PortalStyle;
  githubLink: GitHubLink | null;  // NEW
}
```

A portal can have **both** a nested diagram (`targetDiagramId`) and a GitHub link. This is additive and backward-compatible — existing files without `githubLink` deserialize with the field as `undefined`, treated as `null`.

### OAuth Flow

1. User clicks "GitHub" in the editor header bar
2. Frontend calls `GET /api/github/authorize` to get the OAuth URL
3. A popup opens to GitHub's consent screen (scope: `repo read:user`)
4. After consent, GitHub redirects back with a `code`
5. Frontend sends `POST /api/github/callback` with the code
6. Backend exchanges the code for an access token via GitHub's OAuth API
7. Token is encrypted with AES-256-GCM and stored in `github_connections` table
8. Frontend receives the connection info (username, no token)

**Security**: GitHub tokens never reach the frontend. All GitHub API calls are proxied through the backend, which decrypts the stored token per-request.

### Database Schema

```sql
github_connections (
  id              TEXT PRIMARY KEY,
  user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  github_user_id  TEXT NOT NULL,
  github_username VARCHAR(255) NOT NULL,
  access_token    TEXT NOT NULL,     -- AES-256-GCM encrypted
  refresh_token   TEXT,
  scope           TEXT,
  enterprise_url  TEXT,              -- NULL = github.com
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
)
```

A user can have multiple connections (e.g. github.com + GH Enterprise).

### API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/github/authorize` | Returns OAuth redirect URL |
| POST | `/api/github/callback` | Exchanges code for token, stores connection |
| GET | `/api/github/status` | Lists user's GitHub connections |
| GET | `/api/github/repos` | Lists repos for a connection |
| GET | `/api/github/repos/:owner/:repo/branches` | Lists branches |
| GET | `/api/github/repos/:owner/:repo/tree` | Browses file tree at a path |
| GET | `/api/github/repos/:owner/:repo/contents` | Gets file content |
| DELETE | `/api/github/connections/:id` | Removes a connection |

All endpoints require authentication (`requireAuth` middleware). Repo browsing endpoints require a `connectionId` query parameter.

### GitHub Enterprise Support

The `githubService.ts` accepts a `baseUrl` parameter that defaults to `https://api.github.com`. When an `enterpriseUrl` is set on a connection, all API calls route to `{enterpriseUrl}/api/v3/...` instead. OAuth URLs similarly route to the enterprise instance.

### Portal Linking Flow

1. Select a portal element on the canvas
2. PortalProperties panel shows a "GitHub Link" section
3. Click "Link Repository" to open the RepoBrowser
4. Browse repos, navigate folders, select a path
5. Click "Link to Portal" — the `githubLink` is saved on the element
6. The portal renderer shows a GitHub indicator (icon + `owner/repo`)

### Frontend Components

- **`GitHubConnectDialog`** (`components/github/GitHubConnectDialog.tsx`) — Modal for managing OAuth connections. Lists connected accounts, allows connecting/disconnecting.
- **`RepoBrowser`** (`components/github/RepoBrowser.tsx`) — Two-step file browser: first pick a repo, then browse its tree with branch selector.
- **`PortalProperties`** (`components/elements/PortalProperties.tsx`) — Extended with GitHub link/unlink/browse section.
- **`PortalRenderer`** (`components/elements/PortalRenderer.ts`) — Draws GitHub indicator when `githubLink` is present.

### Frontend State

```typescript
// githubStore.ts (Zustand)
interface GitHubState {
  connections: GitHubConnection[];
  repos: GitHubRepo[];
  branches: GitHubBranch[];
  treeEntries: TreeEntry[];
  fileContent: string | null;
  isLoading: boolean;
  error: string | null;
  // Actions: initialize, connect, disconnect, fetchRepos, fetchTree, etc.
}
```

## LLM-Readable Format

### Package

`packages/llm/` — contains `serialize.ts` and `deserialize.ts`.

### Serialization

`serializeScene(scene, projectName?)` converts a `MavisDrawScene` to structured Markdown:

```markdown
# Architecture: My Project

### Elements

- [rectangle] "API Gateway" → connected to "Auth Service", "User Service"
- [portal] "User Service" → drills into "User Service Detail"
  - github: acme/user-service @ src/

### Connections

- "API Gateway" -->[REST] "Auth Service"
- "API Gateway" --> "User Service"

## User Service Detail

### Elements

- [rectangle] "UserController" → connected to "UserRepository"
  - github: acme/user-service @ src/controllers/UserController.ts
```

**Design decisions:**
- **Topology-only**: No coordinates, sizes, or styling. LLMs care about what's connected to what, not pixel positions.
- **Element names from bound text**: Shapes are labeled by their bound text elements (the text inside them). Falls back to `type_id` if no text.
- **Nested diagrams**: Portal targets are rendered recursively as sub-sections.
- **GitHub links**: Shown as `github: owner/repo @ path` under the element.
- **Ref shown only when non-default**: `main` and `HEAD` refs are omitted for brevity.
- **Deleted elements excluded**: `isDeleted: true` elements are filtered out.

### Deserialization

`deserializeScene(markdown)` parses the structured Markdown back into a `MavisDrawScene`. This enables LLMs to generate architecture diagrams by producing text.

The parser is line-based and lenient:
- Headings create diagram sections
- `- [type] "label"` lines create elements
- `- github: owner/repo @ path` lines set GitHub links
- `- "from" --> "to"` lines create arrow connections
- Elements are auto-laid out in a grid

### Export Integration

The `'llm-text'` format is available in the Export dialog as "LLM-Readable Text (.md)". It exports the full diagram hierarchy (when "Include nested diagrams" is checked) to a `.md` file.

## AI Chat Interface

### Overview

The AI Chat panel lets users interact with a Claude-powered agent that can:

1. **Read the current diagram** — the agent sees the LLM-readable Markdown representation of the diagram on every request.
2. **Browse linked GitHub repos** — the agent uses server-side tools to navigate file trees and read source files from connected GitHub accounts.
3. **Propose diagram changes** — instead of modifying the diagram directly, the agent proposes structured changes (adds, modifications, deletions, connections) that the user reviews and applies with one click.

### User Workflow

1. Click the **"AI Chat"** button in the editor header bar to open the chat panel on the right side.
2. Type a message — for example:
   - *"Describe this diagram"* — the agent reads the current diagram and summarizes its architecture.
   - *"Add a database service connected to the API Gateway"* — the agent proposes adding a rectangle and an arrow.
   - *"Look at the linked repo and suggest services based on the code structure"* — the agent browses the GitHub repo tree, reads key files, then proposes diagram changes.
3. The agent streams its response. Tool usage is shown inline (e.g., "Browsing code...", "Reading file...").
4. When the agent proposes changes, a **ProposalCard** appears showing:
   - A description of the change
   - A summary of each operation (`+ Add "Database"`, `~ Modify "API Gateway"`, `- Delete "Old Service"`, `→ "API" → "Database"`)
   - **Apply** and **Dismiss** buttons
5. Clicking **Apply** creates all elements and connections in a single undo step — pressing Ctrl+Z reverts the entire proposal.
6. Clicking **Dismiss** hides the proposal without making changes.

### Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  Frontend (apps/web)                                        │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────┐  │
│  │ AgentPanel    │  │ ChatMessage  │  │ ProposalCard     │  │
│  │ (useChat)     │  │ (parts-based)│  │ (apply/dismiss)  │  │
│  └──────┬────────┘  └──────────────┘  └────────┬─────────┘  │
│         │                                       │           │
│  ┌──────┴───────────────────────────────────────┘           │
│  │ agentStore.ts (proposals)    uiStore.ts (toggle)         │
│  └──────────────────────┬───────────────────────────────────┘
│                         │ DefaultChatTransport
│                         │ (streaming, auth headers)
├─────────────────────────┼───────────────────────────────────┤
│  Backend (apps/server)  │                                   │
│  ┌──────────────────────┴─────────────────────────────┐     │
│  │ routes/agent.ts (POST /api/agent/chat)             │     │
│  └──────────────────────┬─────────────────────────────┘     │
│  ┌──────────────────────┴─────────────────────────────┐     │
│  │ services/agentService.ts                           │     │
│  │  - Claude model (claude-sonnet-4-20250514)         │     │
│  │  - System prompt (role + current diagram markdown) │     │
│  │  - 4 tools (see below)                             │     │
│  │  - Vercel AI SDK streamText → UIMessageStream      │     │
│  └──────────────────────┬─────────────────────────────┘     │
│                         │ Tool execution                    │
│  ┌──────────────────────┴─────────────────────────────┐     │
│  │ services/githubService.ts (reused)                 │     │
│  │  - getDecryptedToken → getRepoTree / getFileContent│     │
│  └────────────────────────────────────────────────────┘     │
└─────────────────────────────────────────────────────────────┘
```

### How It Works Internally

**Request flow:**

1. The frontend's `AgentPanel` uses Vercel AI SDK's `useChat` hook with a `DefaultChatTransport` configured to POST to `/api/agent/chat`.
2. On each request, the transport sends the conversation `messages` plus a `diagramMarkdown` string — the current diagram serialized via `serializeScene()` from `@mavisdraw/llm`.
3. The server route validates the body, extracts the authenticated user, and calls `streamAgentChat()`.
4. `streamAgentChat()` calls `streamText()` from the Vercel AI SDK with:
   - The Claude model
   - A system prompt containing the diagram markdown
   - The 4 tool definitions
   - `stopWhen: stepCountIs(10)` (max 10 tool-use round-trips)
5. The response is streamed back as a `UIMessageStreamResponse` — the frontend `useChat` hook parses parts as they arrive.

**Agent tools:**

| Tool | Input | What It Does |
|------|-------|-------------|
| `browse_diagram` | _(none)_ | Returns the current diagram markdown passed from the client |
| `browse_code` | `connectionId, owner, repo, path?, ref?` | Decrypts the user's GitHub token and calls `getRepoTree()` to list files/directories |
| `read_file` | `connectionId, owner, repo, path, ref?` | Decrypts the token and calls `getFileContent()` — truncates files >50KB |
| `propose_changes` | `description, changes[], connections[]` | Returns a structured `DiagramProposal` with a unique `proposalId` |

All tool `execute` functions are wrapped in try/catch — errors are returned as `{ error: message }` so the LLM can explain the failure to the user.

**Propose-then-apply:**

The `propose_changes` tool returns a `DiagramProposal`:

```typescript
interface DiagramProposal {
  proposalId: string;
  description: string;
  changes: ProposedChange[];   // add | modify | delete
  connections: ProposedConnection[];  // fromLabel → toLabel
  status: 'pending' | 'applied' | 'dismissed';
}
```

When the user clicks **Apply** on a `ProposalCard`:

1. `pushHistory()` is called once (single undo step).
2. A `labelToId` map is built from existing elements (bound text labels → element IDs).
3. Each `add` change creates a new element + bound text label via `createElement()`.
4. Each `modify` change updates the element or its bound text.
5. Each `delete` change soft-deletes the element (`isDeleted: true`).
6. Each connection creates an arrow element with start/end bindings.
7. The proposal status is set to `'applied'`.

### API Endpoint

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/agent/chat` | Streaming AI chat endpoint |

**Request body:**

```json
{
  "messages": [...],
  "diagramMarkdown": "# Architecture: My Project\n..."
}
```

**Response:** Vercel AI SDK UIMessageStream (chunked streaming).

**Auth:** Requires `Authorization: Bearer <token>` header (same JWT as all other endpoints).

### SDK Details

The AI Chat feature uses **Vercel AI SDK v6**:

| Package | Where | Purpose |
|---------|-------|---------|
| `ai` | Server + Client | Core: `streamText`, `tool`, `zodSchema`, `stepCountIs`, `DefaultChatTransport` |
| `@ai-sdk/react` | Client | `useChat` hook for streaming chat UI |
| `@ai-sdk/anthropic` | Server | Claude provider adapter |

**v6 API notes** (different from older documentation):
- Tools use `inputSchema: zodSchema(z.object({...}))` (not `parameters`)
- Multi-step tool use: `stopWhen: stepCountIs(10)` (not `maxSteps`)
- Chat transport: `new DefaultChatTransport({...})` (not `api` option on `useChat`)
- Server response: `result.toUIMessageStreamResponse()` (not `toDataStreamResponse`)
- Messages use `parts[]` array (not `content` string)

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `ANTHROPIC_API_KEY` | Yes (for AI Chat) | Anthropic API key — read automatically by `@ai-sdk/anthropic` |
| `GITHUB_CLIENT_ID` | Yes (for GitHub) | OAuth App client ID |
| `GITHUB_CLIENT_SECRET` | Yes (for GitHub) | OAuth App client secret |
| `GITHUB_TOKEN_ENCRYPTION_KEY` | Yes (for GitHub) | 64-char hex string (32 bytes) for AES-256-GCM |
| `GITHUB_REDIRECT_URI` | No | OAuth callback URL (default: `http://localhost:3000/api/github/callback`) |

Generate an encryption key:
```typescript
import { generateEncryptionKey } from './utils/encryption';
console.log(generateEncryptionKey()); // 64 hex chars
```

Or with OpenSSL:
```bash
openssl rand -hex 32
```

## File Map

### Backend — GitHub
- `apps/server/src/routes/github.ts` — Fastify route plugin
- `apps/server/src/services/githubService.ts` — OAuth + GitHub API + DB operations
- `apps/server/src/utils/encryption.ts` — AES-256-GCM encrypt/decrypt
- `apps/server/src/db/schema.ts` — `githubConnections` table + relations

### Backend — AI Chat
- `apps/server/src/routes/agent.ts` — `POST /api/agent/chat` streaming endpoint
- `apps/server/src/services/agentService.ts` — Claude model config, system prompt, tool definitions, `streamAgentChat()`

### Frontend — GitHub
- `apps/web/src/services/github.ts` — API client functions
- `apps/web/src/stores/githubStore.ts` — Zustand store
- `apps/web/src/components/github/GitHubConnectDialog.tsx` — OAuth UI
- `apps/web/src/components/github/RepoBrowser.tsx` — File tree browser

### Frontend — AI Chat
- `apps/web/src/stores/agentStore.ts` — Zustand store for diagram proposals
- `apps/web/src/components/agent/AgentPanel.tsx` — Chat panel with `useChat` hook
- `apps/web/src/components/agent/ChatMessage.tsx` — Message rendering (text + tool parts)
- `apps/web/src/components/agent/ProposalCard.tsx` — Apply/Dismiss change proposals

### Shared Types
- `packages/types/src/elements.ts` — `GitHubLink`, extended `PortalElement`
- `packages/types/src/export.ts` — `'llm-text'` added to `ExportFormat`
- `packages/types/src/agent.ts` — `DiagramProposal`, `ProposedChange`, `ProposedConnection`

### LLM Package
- `packages/llm/src/serialize.ts` — Scene → Markdown
- `packages/llm/src/deserialize.ts` — Markdown → Scene
- `packages/llm/src/index.ts` — Public exports
