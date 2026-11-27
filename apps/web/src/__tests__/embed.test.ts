import { describe, it, expect } from 'vitest';
import { ancestry, fitView, parseEmbedUrl, zoomAt, MAX_SCALE } from '../embed/model';
import { embedSnippets } from '../components/collaboration/embedSnippets';

const TOKEN = 'AbCdEfGhIjKlMnOpQrStUvWx';

describe('embed viewer', () => {
  it('reads the token, start diagram and theme from the URL', () => {
    expect(parseEmbedUrl(`?t=${TOKEN}&d=child&theme=dark`)).toEqual({
      token: TOKEN,
      diagramId: 'child',
      theme: 'dark',
    });
    expect(parseEmbedUrl(`?t=${TOKEN}&theme=purple`)?.theme).toBe('auto');
    expect(parseEmbedUrl('?t=short')).toBeNull();
    expect(parseEmbedUrl('?t=<script>alert(1)</script>xxxxxxxx')).toBeNull();
    expect(parseEmbedUrl('')).toBeNull();
  });

  it('knows the path from the top-level map down to a nested diagram', () => {
    const diagrams = [
      { id: 'root', title: 'Shop', parentDiagramId: null },
      { id: 'api', title: 'API', parentDiagramId: 'root' },
      { id: 'auth', title: 'Auth', parentDiagramId: 'api' },
    ];
    expect(ancestry(diagrams, 'auth', 'root')).toEqual(['root', 'api', 'auth']);
    expect(ancestry(diagrams, 'root', 'root')).toEqual(['root']);
    // A diagram that isn't in this project starts at the top
    expect(ancestry(diagrams, 'elsewhere', 'root')).toEqual(['root']);
  });

  it('survives a cycle in the hierarchy', () => {
    const loop = [
      { id: 'a', title: 'A', parentDiagramId: 'b' },
      { id: 'b', title: 'B', parentDiagramId: 'a' },
    ];
    expect(ancestry(loop, 'a', 'root')).toEqual(['root', 'b', 'a']);
  });

  it('fits and centers the content, without blowing small diagrams up', () => {
    const view = fitView(400, 200, 832, 432);
    expect(view.scale).toBe(1.5);
    expect(view.x).toBe((832 - 600) / 2);
    expect(fitView(4000, 1000, 832, 432).scale).toBeCloseTo(0.2);
  });

  it('zooms around the cursor, within limits', () => {
    const view = zoomAt({ x: 0, y: 0, scale: 1 }, 2, 100, 50);
    expect(view).toEqual({ x: -100, y: -50, scale: 2 });
    expect(zoomAt({ x: 0, y: 0, scale: 3 }, 10, 0, 0).scale).toBe(MAX_SCALE);
  });
});

describe('embed snippets', () => {
  const s = embedSnippets('https://app.example', 'https://api.example', TOKEN, 'Shop "v2" [beta]');

  it('points the iframe at the viewer and the README at the live image', () => {
    expect(s.viewerUrl).toBe(`https://app.example/embed.html?t=${TOKEN}`);
    expect(s.imageUrl).toBe(`https://api.example/api/embed/${TOKEN}/svg`);
    expect(s.iframe).toContain(`src="https://app.example/embed.html?t=${TOKEN}"`);
    expect(s.readmeHtml).toContain(
      `srcset="https://api.example/api/embed/${TOKEN}/svg?theme=dark"`,
    );
  });

  it('escapes the project name wherever it appears', () => {
    expect(s.iframe).toContain('title="Shop &quot;v2&quot; [beta] architecture"');
    expect(s.markdown).toBe(
      `[![Shop "v2" \\[beta\\] architecture](https://api.example/api/embed/${TOKEN}/svg)](https://app.example/embed.html?t=${TOKEN})`,
    );
  });
});
