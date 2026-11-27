# Embeds

Publish a map read-only — for docs, wikis, Notion, Confluence or a GitHub README — and it stays
current as the team edits it.

**Share → Embed → Publish an embed** (owners and admins). You get:

| Where              | What                                                                                                                                                                                                        |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Website / docs** | An `<iframe>` with the interactive viewer: click a nested system to look inside, breadcrumb to go back, drag to pan, Ctrl/⌘ + scroll or the buttons to zoom. Plain scrolling stays with the page around it. |
| **GitHub README**  | An image (`/api/embed/<token>/svg`) rendered from the live map, with a dark variant GitHub picks for dark-theme readers. Wrapped in a link to the viewer.                                                   |
| **Link**           | The viewer on its own (`/embed.html?t=<token>`).                                                                                                                                                            |

Anyone with the link can view **every level** of the map, without signing in. **New link** replaces
the token (old embeds and images stop working); **Unpublish** withdraws it everywhere.

## Options

- Viewer: `&d=<diagramId>` opens a nested diagram first; `&theme=light|dark` (default: the reader's
  system setting).
- Image: `?d=<diagramId>`, `?theme=dark`, `?style=clean|sketchy` (default: the diagram's own style).

## Details

- The image and the viewer share one renderer (`@mavisdraw/export/svg-markup`), which runs without a
  DOM. Every color, number and piece of text from the diagram is validated or escaped; the image is
  also served with `Content-Security-Policy: default-src 'none'` and `X-Content-Type-Options: nosniff`.
- Images are cacheable for 5 minutes and carry an ETag. The viewer refreshes every minute while
  visible.
- Public endpoints are rate-limited to 600 requests per minute per IP.
