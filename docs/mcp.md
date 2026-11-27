# Coding agents (MCP)

MavisDraw serves the team's architecture map to coding agents — Claude Code, Cursor, VS Code,
Windsurf, anything that speaks the [Model Context Protocol](https://modelcontextprotocol.io). Agents
learn which component owns the code they're changing, what it talks to and who depends on it, and
when a change alters the architecture they **propose** a map update. A person reviews and applies it
in the editor; agents never change the map directly.

## Connect an agent

1. In MavisDraw, click **Connect a coding agent** on the dashboard (or ⌘K → _Connect a coding agent…_).
2. Name a token ("Claude Code on my laptop") and create it. It's shown once.
3. Paste the setup it gives you:

   **Claude Code**

   ```sh
   claude mcp add --transport http mavisdraw https://<your-api-host>/api/mcp \
     --header "Authorization: Bearer mdw_…"
   ```

   **Cursor, VS Code and others** (MCP JSON settings)

   ```json
   {
     "mcpServers": {
       "mavisdraw": {
         "type": "http",
         "url": "https://<your-api-host>/api/mcp",
         "headers": { "Authorization": "Bearer mdw_…" }
       }
     }
   }
   ```

A token acts as you: the agent sees the projects you can open, and can propose updates where you
can edit. Revoke it in the same dialog; it stops working on the next request.

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
- **Auth:** `Authorization: Bearer mdw_…`. Only a SHA-256 hash of each token is stored.
- **Limits:** 120 MCP requests per minute per IP; 20 tokens per person; 100 pending proposals per
  project.
- Diagram labels are written by people, so tool output tells the agent to treat them as data.
