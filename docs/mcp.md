# Coding agents (MCP)

MavisDraw serves the team's architecture map to coding agents — Claude Code, Cursor, VS Code,
Windsurf, anything that speaks the [Model Context Protocol](https://modelcontextprotocol.io). Agents
learn which component owns the code they're changing, what it talks to and who depends on it, and
when a change alters the architecture they **propose** a map update. A person reviews and applies it
in the editor; agents never change the map directly.

## Connect an agent

### Sign in from the agent (recommended)

Add the server without any token; the first time the agent connects, it opens your browser to sign in
to MavisDraw:

**Claude Code**

```sh
claude mcp add --transport http mavisdraw https://<your-api-host>/api/mcp
```

**Cursor, VS Code and others** (MCP JSON settings)

```json
{
  "mcpServers": {
    "mavisdraw": { "type": "http", "url": "https://<your-api-host>/api/mcp" }
  }
}
```

The browser shows which agent is asking and where approving will send you (back to the agent on
your computer, or the site or app it named). You choose what it may do:

- **Read maps and propose updates** (what agents ask for by default), or **only read maps**;
- **every map you can open**, or **only the maps you choose**.

Only approve a sign-in you just started yourself. The connection appears in **Connect a coding
agent** as _signed in_, with its limits, and **Disconnect** ends it at once.

### Or use an access token

For agents that can't open a browser (CI jobs, older clients):

1. In MavisDraw, click **Connect a coding agent** on the dashboard (or ⌘K → _Connect a coding
   agent…_).
2. Name a token ("Claude Code on my laptop"), choose what it may do and on which maps, and create it.
   It's shown once.
3. Paste the setup it gives you:

   ```sh
   claude mcp add --transport http mavisdraw https://<your-api-host>/api/mcp \
     --header "Authorization: Bearer mdw_…"
   ```

   or, in MCP JSON settings, add `"headers": { "Authorization": "Bearer mdw_…" }` next to the `url`.

An agent acts as you, within the limits you chose: it sees the maps you can open (or only the chosen
ones) and can propose updates where you can edit, unless it's read-only. A read-only connection
isn't offered `propose_update` at all. Revoke a token in the same dialog; it stops working on the
next request.

## Tools

| Tool                | What it does                                                                                                                                            |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `list_projects`     | Projects you can open, your role, and the repository a map was generated from                                                                           |
| `read_architecture` | A project's map as Markdown — components, connections, nested diagrams, linked folders — or one nested diagram and what's under it                      |
| `find_component`    | Components by name, or by a file/folder path: returns the component that owns that code (most specific first), where it sits, its links and connections, and its component id |
| `get_component`     | One component of the architecture model (by id, name or code path): kind, description, technology, owner, links, code, every diagram it's drawn on, what it's part of and contains, and its dependencies and dependents across all levels (see [the model](model-layer.md)) |
| `propose_update`    | Add, connect, rename or remove components on one diagram, by name or component id. Waits for review                                                                     |

Proposals appear live in the editor under **Proposals** (and ⌘K → _Proposed map updates_), with the
agent's description and exactly what would change. **Apply** makes it one undoable step on the
diagram it targets; **Dismiss** drops it. Only people who can edit the project can do either.

## Details

- **Endpoint:** `POST /api/mcp`, Streamable HTTP, stateless (each request carries the token; any
  server instance can answer). `GET`/`DELETE` return 405.
- **Auth:** `Authorization: Bearer mdw_…`, a personal token or one issued by signing in. Only SHA-256
  hashes of tokens are stored.
- **Signing in** is OAuth 2.1 as the MCP specification describes it:
  - a request without a valid token gets `401` with `WWW-Authenticate: Bearer
    resource_metadata="…/.well-known/oauth-protected-resource/api/mcp"` (RFC 9728);
  - authorization server metadata is at `/.well-known/oauth-authorization-server` (RFC 8414);
  - agents register themselves at `/api/oauth/register` (RFC 7591). They are all public clients
    (`token_endpoint_auth_method: none`), so PKCE with `S256` is required;
  - redirect addresses must be `https`, `http` back to this computer (any port), or an app's own
    scheme; never `javascript:`, `data:` or the like;
  - the consent page is `/connect-agent` in the web app. Codes last a minute and work once;
  - access tokens last an hour and are renewed with a refresh token, which works once (each use
    hands out a new one) and lapses after 60 days without use;
  - revoke with `/api/oauth/revoke` (RFC 7009) or from the dialog;
  - scopes are `mcp:read` and `mcp:propose`. An agent that asks only for `mcp:read` can't be granted
    more.
- **Self-hosting:** the agent finds the metadata under `/.well-known/oauth-…` on the API's address,
  so a proxy in front of the API must pass those paths on. The bundled nginx and Caddy
  configurations do.
- **Limits:** 120 MCP requests per minute per IP; 20 tokens and 20 signed-in agents per person (the
  least recently used sign-in goes); 100 pending proposals per project.
- Diagram labels are written by people, so tool output tells the agent to treat them as data.
