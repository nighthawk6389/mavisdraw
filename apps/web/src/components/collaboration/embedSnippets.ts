/**
 * Ready-to-paste ways to show a published map elsewhere: an interactive
 * iframe (docs, wikis, Notion) and a README image that stays current, with
 * a dark variant for GitHub's dark theme.
 */
export interface EmbedSnippets {
  viewerUrl: string;
  imageUrl: string;
  iframe: string;
  markdown: string;
  /** README with light and dark images (GitHub picks by the reader's theme). */
  readmeHtml: string;
}

const attr = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const markdownText = (s: string) => s.replace(/[[\]\\]/g, '\\$&');

export function embedSnippets(
  webOrigin: string,
  apiBase: string,
  token: string,
  projectName: string,
): EmbedSnippets {
  const viewerUrl = `${webOrigin}/embed.html?t=${token}`;
  const imageUrl = `${apiBase}/api/embed/${token}/svg`;
  const title = `${projectName} architecture`;
  return {
    viewerUrl,
    imageUrl,
    iframe: `<iframe src="${viewerUrl}" title="${attr(title)}" width="100%" height="480" style="border: 1px solid #e5e7eb; border-radius: 8px" allowfullscreen></iframe>`,
    markdown: `[![${markdownText(title)}](${imageUrl})](${viewerUrl})`,
    readmeHtml: [
      `<a href="${viewerUrl}">`,
      '  <picture>',
      `    <source media="(prefers-color-scheme: dark)" srcset="${imageUrl}?theme=dark">`,
      `    <img alt="${attr(title)}" src="${imageUrl}">`,
      '  </picture>',
      '</a>',
    ].join('\n'),
  };
}
