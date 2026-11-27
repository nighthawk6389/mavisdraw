import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as Y from 'yjs';
import type { MavisElement } from '@mavisdraw/types';
import { parseRoute, projectPath, navigate, reflectPath } from '../routing';
import { usePermissionStore, canEdit } from '../stores/permissionStore';
import { useElementsStore, isElementsReadOnly } from '../stores/elementsStore';
import { collaborationUrl } from '../stores/collaborationStore';
import { absoluteApiBase, resolveApiBase } from '../services/apiBase';
import { docVersion, readElement, writeElement } from '../collab/ydocElements';
import { flushPendingSaves, registerSaveFlusher } from '../services/saveTracker';
import { useVersionStore } from '../stores/versionStore';
import { useDiagramStore } from '../stores/diagramStore';
import { apiSaveDiagram } from '../services/api';

vi.mock('../services/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../services/api')>()),
  apiSaveDiagram: vi.fn(async () => ({})),
  apiListSnapshots: vi.fn(async () => ({ snapshots: [] })),
}));

const D = 'diagram-1';
const store = () => useElementsStore.getState();

function rect(id: string, extra: Partial<MavisElement> = {}): MavisElement {
  const base = store().createElement('rectangle', D, 0, 0, 100, 50);
  return { ...base, id, ...extra } as MavisElement;
}

describe('routing', () => {
  it('parses every app address', () => {
    expect(parseRoute('/')).toEqual({ name: 'dashboard' });
    expect(parseRoute('/p/abc')).toEqual({ name: 'project', projectId: 'abc', diagramId: null });
    expect(parseRoute('/p/abc/d/xyz')).toEqual({
      name: 'project',
      projectId: 'abc',
      diagramId: 'xyz',
    });
    expect(parseRoute('/share/tok123')).toEqual({ name: 'share', token: 'tok123' });
    // The confirmation link (its token is in the query string)
    expect(parseRoute('/verify-email')).toEqual({ name: 'verifyEmail' });
    expect(parseRoute('/reset-password')).toEqual({ name: 'resetPassword' });
    // A coding agent signing in (the request id is in the query string)
    expect(parseRoute('/connect-agent')).toEqual({ name: 'connectAgent' });
    // Unknown or incomplete paths fall back to the dashboard
    expect(parseRoute('/p')).toEqual({ name: 'dashboard' });
    expect(parseRoute('/nope')).toEqual({ name: 'dashboard' });
  });

  it('builds paths that round-trip, including awkward ids', () => {
    expect(projectPath('p1')).toBe('/p/p1');
    expect(projectPath('p1', 'd 2')).toBe('/p/p1/d/d%202');
    expect(parseRoute(projectPath('a/b', 'c?d'))).toEqual({
      name: 'project',
      projectId: 'a/b',
      diagramId: 'c?d',
    });
  });

  it('navigate pushes history; reflectPath replaces it', () => {
    navigate('/');
    const before = window.history.length;
    navigate('/p/one');
    expect(window.location.pathname).toBe('/p/one');
    expect(window.history.length).toBe(before + 1);

    reflectPath('/p/one/d/two');
    expect(window.location.pathname).toBe('/p/one/d/two');
    expect(window.history.length).toBe(before + 1);

    navigate('/p/three', { replace: true });
    expect(window.location.pathname).toBe('/p/three');
    expect(window.history.length).toBe(before + 1);
  });
});

describe('permissions', () => {
  beforeEach(() => {
    useElementsStore.setState({
      elements: new Map(),
      history: [],
      historyIndex: -1,
      clipboard: null,
    });
  });
  afterEach(() => {
    usePermissionStore.getState().setRole(null);
  });

  it('editors and owners can edit; viewers cannot', () => {
    for (const role of ['owner', 'admin', 'editor'] as const) {
      usePermissionStore.getState().setRole(role);
      expect(canEdit()).toBe(true);
      expect(isElementsReadOnly()).toBe(false);
    }
    usePermissionStore.getState().setRole('viewer');
    expect(canEdit()).toBe(false);
    expect(isElementsReadOnly()).toBe(true);
  });

  it('the element store refuses local edits from a viewer', () => {
    const a = rect('a');
    store().addElement(a);
    usePermissionStore.getState().setRole('viewer');

    store().addElement(rect('b'));
    store().updateElement('a', { x: 500 });
    store().deleteElements(['a']);
    expect(store().duplicateElements(['a'])).toEqual([]);
    expect(store().pasteElements(D)).toEqual([]);
    expect(store().groupElements(['a'])).toBe('');
    store().undo();

    const els = store().elements;
    expect(els.size).toBe(1);
    expect(els.get('a')?.x).toBe(0);
    expect(els.get('a')?.isDeleted).toBe(false);
  });

  it('remote changes still reach a viewer', () => {
    usePermissionStore.getState().setRole('viewer');
    // Collaboration writes go straight to the store state
    useElementsStore.setState({ elements: new Map([['r', rect('r', { x: 42 })]]) });
    expect(store().elements.get('r')?.x).toBe(42);
  });

  it('copying stays available to viewers', () => {
    store().addElement(rect('a'));
    usePermissionStore.getState().setRole('viewer');
    expect(store().copyElements(['a'])).not.toBeNull();
  });
});

describe('collaborationUrl', () => {
  it('always targets the /collaboration endpoint with a ws scheme', () => {
    expect(collaborationUrl(undefined, 'http://localhost:3001')).toBe(
      'ws://localhost:3001/collaboration',
    );
    expect(collaborationUrl('https://api.example.com', undefined)).toBe(
      'wss://api.example.com/collaboration',
    );
    expect(collaborationUrl('wss://api.example.com/collaboration', undefined)).toBe(
      'wss://api.example.com/collaboration',
    );
    expect(collaborationUrl('ws://h:1/base/', undefined)).toBe('ws://h:1/base/collaboration');
  });

  it('with the API on this origin (self-hosted proxy), uses the page’s own host', () => {
    expect(collaborationUrl(undefined, '', 'https://draw.acme.com')).toBe(
      'wss://draw.acme.com/collaboration',
    );
    expect(collaborationUrl('', '', 'http://10.0.0.5:8080')).toBe(
      'ws://10.0.0.5:8080/collaboration',
    );
    // Unset (local development) still means the API on 3001
    expect(collaborationUrl(undefined, undefined, 'http://localhost:3000')).toBe(
      'ws://localhost:3001/collaboration',
    );
  });
});

describe('API address', () => {
  it('empty means this origin: relative requests, absolute links from the page', () => {
    expect(resolveApiBase('')).toBe('');
    expect(resolveApiBase(undefined)).toBe('http://localhost:3001');
    expect(resolveApiBase('https://api.acme.com/')).toBe('https://api.acme.com');
    expect(absoluteApiBase('')).toBe(window.location.origin);
    expect(absoluteApiBase('https://api.acme.com')).toBe('https://api.acme.com');
  });
});

describe('client Y.Doc element helpers', () => {
  beforeEach(() => {
    useElementsStore.setState({
      elements: new Map(),
      history: [],
      historyIndex: -1,
      clipboard: null,
    });
  });

  it('concurrent edits to different properties of one element merge', () => {
    const a = new Y.Doc();
    const b = new Y.Doc();
    const original = rect('s1', { version: 1 });
    writeElement(a.getMap('elements'), original);
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a));

    writeElement(a.getMap('elements'), { ...original, x: 100, version: 2 });
    writeElement(b.getMap('elements'), { ...original, strokeColor: '#ff0000', version: 2 });
    Y.applyUpdate(a, Y.encodeStateAsUpdate(b));
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a));

    for (const doc of [a, b]) {
      const merged = readElement(doc.getMap('elements').get('s1'));
      expect(merged?.x).toBe(100);
      expect(merged?.strokeColor).toBe('#ff0000');
    }
  });

  it('drops properties that become undefined and reports versions', () => {
    const doc = new Y.Doc();
    const map = doc.getMap<unknown>('elements');
    const el = rect('s1', { version: 3, zIndex: 7 });
    writeElement(map, el);
    expect(docVersion(map, 's1')).toBe(3);
    expect(docVersion(map, 'missing')).toBe(-1);

    writeElement(map, { ...el, zIndex: undefined, version: 4 });
    const stored = map.get('s1') as Y.Map<unknown>;
    expect(stored.has('zIndex')).toBe(false);
    expect(docVersion(map, 's1')).toBe(4);
    expect(readElement('not a map')).toBeNull();
  });
});

describe('version snapshots', () => {
  afterEach(() => registerSaveFlusher(null));

  it('flushPendingSaves runs the registered autosave, or nothing', async () => {
    await expect(flushPendingSaves()).resolves.toBeUndefined();
    const flush = vi.fn(async () => {});
    registerSaveFlusher(flush);
    await flushPendingSaves();
    expect(flush).toHaveBeenCalledOnce();
  });

  it('saves pending edits before snapshotting a diagram with no live room', async () => {
    useDiagramStore.setState({ activeDiagramId: D });
    const order: string[] = [];
    registerSaveFlusher(async () => {
      order.push('flush');
    });
    vi.mocked(apiSaveDiagram).mockImplementationOnce(async () => {
      order.push('snapshot');
      return {};
    });

    await useVersionStore.getState().saveSnapshot('Before launch');
    expect(order).toEqual(['flush', 'snapshot']);
    expect(apiSaveDiagram).toHaveBeenCalledWith(D, 'manual', 'Before launch');
  });
});
