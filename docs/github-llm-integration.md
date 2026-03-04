# GitHub Integration & LLM-Readable Format

This document describes how MavisDraw connects to GitHub repositories and how the LLM-readable export format works.

## Overview

MavisDraw's portal elements can now link to GitHub repositories in addition to nested diagrams. This enables architecture diagrams to reference actual source code. The LLM-readable export format produces a topology-only Markdown representation of diagrams that AI agents can parse and generate.

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

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
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

### Backend
- `apps/server/src/routes/github.ts` — Fastify route plugin
- `apps/server/src/services/githubService.ts` — OAuth + GitHub API + DB operations
- `apps/server/src/utils/encryption.ts` — AES-256-GCM encrypt/decrypt
- `apps/server/src/db/schema.ts` — `githubConnections` table + relations

### Frontend
- `apps/web/src/services/github.ts` — API client functions
- `apps/web/src/stores/githubStore.ts` — Zustand store
- `apps/web/src/components/github/GitHubConnectDialog.tsx` — OAuth UI
- `apps/web/src/components/github/RepoBrowser.tsx` — File tree browser

### Shared Types
- `packages/types/src/elements.ts` — `GitHubLink`, extended `PortalElement`
- `packages/types/src/export.ts` — `'llm-text'` added to `ExportFormat`

### LLM Package
- `packages/llm/src/serialize.ts` — Scene → Markdown
- `packages/llm/src/deserialize.ts` — Markdown → Scene
- `packages/llm/src/index.ts` — Public exports
