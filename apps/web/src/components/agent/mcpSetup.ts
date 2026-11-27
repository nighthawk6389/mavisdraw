/**
 * How to connect a coding agent to MavisDraw's MCP endpoint, ready to paste.
 * Claude Code takes a command; most other clients (Cursor, VS Code,
 * Windsurf…) take a JSON block in their MCP settings.
 */
export interface McpSetup {
  claudeCode: string;
  json: string;
}

/**
 * Without a token, the agent signs in through the browser the first time it
 * connects (OAuth): nothing secret to paste.
 */
export function mcpSetup(url: string, token?: string): McpSetup {
  const header = token ? ` --header "Authorization: Bearer ${token}"` : '';
  return {
    claudeCode: `claude mcp add --transport http mavisdraw ${url}${header}`,
    json: JSON.stringify(
      {
        mcpServers: {
          mavisdraw: token
            ? { type: 'http', url, headers: { Authorization: `Bearer ${token}` } }
            : { type: 'http', url },
        },
      },
      null,
      2,
    ),
  };
}

/** "3 min ago" / "yesterday" / a date, for token and proposal timestamps. */
export function timeAgo(iso: string, now = Date.now()): string {
  const seconds = Math.max(0, (now - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days} days ago`;
  return new Date(iso).toLocaleDateString();
}
