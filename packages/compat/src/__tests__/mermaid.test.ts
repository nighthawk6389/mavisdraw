import { describe, it, expect } from 'vitest';
import {
  isMermaidFlowchart,
  parseMermaidFlowchart,
  MermaidParseError,
} from '../mermaid/parse';

describe('isMermaidFlowchart', () => {
  it('detects graph and flowchart headers, fenced or not', () => {
    expect(isMermaidFlowchart('graph TD\n A-->B')).toBe(true);
    expect(isMermaidFlowchart('flowchart LR\n  a --> b')).toBe(true);
    expect(isMermaidFlowchart('```mermaid\nflowchart TB\nA-->B\n```')).toBe(true);
    expect(isMermaidFlowchart('%% comment\ngraph LR\nA-->B')).toBe(true);
  });

  it('rejects other text', () => {
    expect(isMermaidFlowchart('hello world')).toBe(false);
    expect(isMermaidFlowchart('sequenceDiagram\nA->>B: hi')).toBe(false);
    expect(isMermaidFlowchart('# Architecture: X')).toBe(false);
  });
});

describe('parseMermaidFlowchart', () => {
  it('reads direction and simple links', () => {
    const g = parseMermaidFlowchart('graph LR\n  A --> B\n  B --> C');
    expect(g.direction).toBe('LR');
    expect(Array.from(g.nodes.keys())).toEqual(['A', 'B', 'C']);
    expect(g.edges.map((e) => `${e.from}->${e.to}`)).toEqual(['A->B', 'B->C']);
  });

  it('treats TD as TB', () => {
    expect(parseMermaidFlowchart('flowchart TD\nA-->B').direction).toBe('TB');
  });

  it('reads node shapes and labels', () => {
    const g = parseMermaidFlowchart(`flowchart TB
      a[Web App]
      b(Rounded)
      c([Stadium])
      d[[Subroutine]]
      e[(Orders DB)]
      f((Circle))
      g{Decision?}
      h{{Hex}}
      i>Flag]
      j[/Input/]`);
    const shapes = Object.fromEntries(Array.from(g.nodes.values()).map((n) => [n.id, [n.shape, n.label]]));
    expect(shapes).toEqual({
      a: ['rect', 'Web App'],
      b: ['round', 'Rounded'],
      c: ['stadium', 'Stadium'],
      d: ['subroutine', 'Subroutine'],
      e: ['cylinder', 'Orders DB'],
      f: ['circle', 'Circle'],
      g: ['diamond', 'Decision?'],
      h: ['hexagon', 'Hex'],
      i: ['asymmetric', 'Flag'],
      j: ['parallelogram', 'Input'],
    });
  });

  it('handles quoted labels containing brackets and <br>', () => {
    const g = parseMermaidFlowchart('graph TD\n A["Queue [kafka]"] --> B["Line 1<br/>Line 2"]');
    expect(g.nodes.get('A')!.label).toBe('Queue [kafka]');
    expect(g.nodes.get('B')!.label).toBe('Line 1\nLine 2');
  });

  it('reads link labels in both syntaxes', () => {
    const g = parseMermaidFlowchart(`graph LR
      A -->|REST| B
      B -- publishes --> C
      C -. async .-> D
      D == hot path ==> E`);
    expect(g.edges.map((e) => [e.label, e.style])).toEqual([
      ['REST', 'solid'],
      ['publishes', 'solid'],
      ['async', 'dotted'],
      ['hot path', 'thick'],
    ]);
  });

  it('reads link styles and arrowheads', () => {
    const g = parseMermaidFlowchart(`graph LR
      A --- B
      B -.-> C
      C ==> D
      D <--> E
      E ---> F`);
    expect(g.edges.map((e) => [e.style, e.arrowStart, e.arrowEnd])).toEqual([
      ['solid', false, false],
      ['dotted', false, true],
      ['thick', false, true],
      ['solid', true, true],
      ['solid', false, true],
    ]);
  });

  it('expands chains and & groups', () => {
    const g = parseMermaidFlowchart('graph TD\n A & B --> C --> D & E');
    expect(g.edges.map((e) => `${e.from}->${e.to}`)).toEqual(['A->C', 'B->C', 'C->D', 'C->E']);
  });

  it('accepts links without spaces and ids with dashes', () => {
    const g = parseMermaidFlowchart('graph TD\napi-gateway[API]-->auth-svc[Auth]');
    expect(g.edges).toHaveLength(1);
    expect(g.edges[0].from).toBe('api-gateway');
    expect(g.nodes.get('auth-svc')!.label).toBe('Auth');
  });

  it('builds nested subgraphs and assigns nodes to them', () => {
    const g = parseMermaidFlowchart(`flowchart LR
      user((User)) --> web
      subgraph platform [Checkout Platform]
        direction TB
        web[Web App] --> api
        subgraph data [Data Layer]
          db[(Postgres)]
        end
        api[API] --> db
      end`);
    expect(Array.from(g.subgraphs.values())).toEqual([
      { id: 'platform', title: 'Checkout Platform', parent: null, direction: 'TB' },
      { id: 'data', title: 'Data Layer', parent: 'platform', direction: null },
    ]);
    expect(g.nodes.get('user')!.subgraph).toBeNull();
    expect(g.nodes.get('web')!.subgraph).toBe('platform');
    expect(g.nodes.get('api')!.subgraph).toBe('platform');
    expect(g.nodes.get('db')!.subgraph).toBe('data');
  });

  it('supports quoted and multi-word subgraph titles', () => {
    const g = parseMermaidFlowchart('graph TD\nsubgraph "Payments Team"\nA\nend\nsubgraph Two Words\nB\nend');
    const titles = Array.from(g.subgraphs.values()).map((s) => [s.id, s.title]);
    expect(titles).toEqual([
      ['Payments_Team', 'Payments Team'],
      ['Two_Words', 'Two Words'],
    ]);
  });

  it('lets links target a subgraph by id', () => {
    const g = parseMermaidFlowchart('graph TD\nsubgraph backend\napi\nend\nclient --> backend');
    expect(g.nodes.has('backend')).toBe(false);
    expect(g.edges[0]).toMatchObject({ from: 'client', to: 'backend' });
  });

  it('ignores comments, styling and statement separators', () => {
    const g = parseMermaidFlowchart(`graph TD
      %% a comment
      A-->B; B-->C
      classDef hot fill:#f96
      class A hot
      style B fill:#bbf
      linkStyle 0 stroke:#f00
      click A "https://example.com"
      C:::hot --> D`);
    expect(g.edges.map((e) => `${e.from}->${e.to}`)).toEqual(['A->B', 'B->C', 'C->D']);
  });

  it('strips a markdown fence', () => {
    const g = parseMermaidFlowchart('Some README text\n```mermaid\ngraph TD\nA-->B\n```\nmore');
    expect(g.edges).toHaveLength(1);
  });

  it('reports errors with line numbers', () => {
    expect(() => parseMermaidFlowchart('graph TD\nsubgraph X\nA')).toThrow(MermaidParseError);
    expect(() => parseMermaidFlowchart('graph TD\nA --> ')).toThrow(/Line 2/);
    expect(() => parseMermaidFlowchart('sequenceDiagram')).toThrow(/header/);
  });
});
