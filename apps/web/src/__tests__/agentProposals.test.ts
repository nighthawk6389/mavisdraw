import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mcpSetup, timeAgo } from '../components/agent/mcpSetup';
import { describeScope, scopeIsComplete } from '../components/agent/TokenScopeFields';
import { useProposalsStore } from '../stores/proposalsStore';
import { useToastStore } from '../stores/toastStore';
import { ApiError, apiListProposals, apiResolveProposal, type ProposalData } from '../services/api';
import { goToDiagram, loadDiagramElements } from '../services/diagramSync';
import { applyProposal } from '../components/agent/applyProposal';
import { useElementsStore } from '../stores/elementsStore';

vi.mock('../services/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../services/api')>()),
  apiListProposals: vi.fn(),
  apiResolveProposal: vi.fn(),
}));
vi.mock('../services/diagramSync', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../services/diagramSync')>()),
  goToDiagram: vi.fn(async () => true),
  loadDiagramElements: vi.fn(async () => undefined),
}));
vi.mock('../components/agent/applyProposal', async () => {
  const { useElementsStore } = await import('../stores/elementsStore');
  return {
    // Its undo step is wherever history is right after it
    applyProposal: vi.fn(async () => ({
      added: 1,
      modified: 0,
      deleted: 0,
      connected: 1,
      step: useElementsStore.getState().historyIndex,
    })),
  };
});

const proposal = (id: string, extra: Partial<ProposalData> = {}): ProposalData => ({
  id,
  projectId: 'p1',
  diagramId: 'd-api',
  source: 'agent',
  sourceLabel: 'Claude Code (laptop)',
  sourceUrl: null,
  authorName: 'Ada',
  description: 'Payments go through Stripe',
  changes: [{ action: 'add', elementType: 'rectangle', label: 'Payments' }],
  connections: [{ fromLabel: 'API', toLabel: 'Payments' }],
  status: 'pending',
  createdAt: new Date().toISOString(),
  ...extra,
});

const store = () => useProposalsStore.getState();
const toasts = () => useToastStore.getState().toasts.map((t) => t.message);

beforeEach(() => {
  vi.mocked(apiListProposals).mockReset();
  vi.mocked(apiResolveProposal).mockReset().mockResolvedValue({ ok: true });
  vi.mocked(goToDiagram).mockClear();
  vi.mocked(loadDiagramElements).mockClear();
  vi.mocked(applyProposal).mockClear();
  useToastStore.setState({ toasts: [] });
  store().reset();
});

describe('connecting a coding agent', () => {
  it('gives a Claude Code command and a JSON config with the token', () => {
    const setup = mcpSetup('https://api.example/api/mcp', 'mdw_secret');
    expect(setup.claudeCode).toBe(
      'claude mcp add --transport http mavisdraw https://api.example/api/mcp --header "Authorization: Bearer mdw_secret"',
    );
    expect(JSON.parse(setup.json)).toEqual({
      mcpServers: {
        mavisdraw: {
          type: 'http',
          url: 'https://api.example/api/mcp',
          headers: { Authorization: 'Bearer mdw_secret' },
        },
      },
    });
  });

  it('without a token, the agent signs in through the browser: nothing secret to paste', () => {
    const setup = mcpSetup('https://api.example/api/mcp');
    expect(setup.claudeCode).toBe(
      'claude mcp add --transport http mavisdraw https://api.example/api/mcp',
    );
    expect(JSON.parse(setup.json)).toEqual({
      mcpServers: { mavisdraw: { type: 'http', url: 'https://api.example/api/mcp' } },
    });
  });

  it('says what a limited token may do, and only submits a limited one with a map', () => {
    expect(describeScope('propose', null)).toBeNull();
    expect(describeScope('read', null)).toBe('Read only');
    expect(describeScope('propose', [{ name: 'Shop' }])).toBe('only “Shop”');
    expect(describeScope('read', [{ name: 'A' }, { name: 'B' }])).toBe('Read only · 2 maps');
    expect(scopeIsComplete({ access: 'read', projectIds: null })).toBe(true);
    expect(scopeIsComplete({ access: 'read', projectIds: [] })).toBe(false);
    expect(scopeIsComplete({ access: 'read', projectIds: ['p1'] })).toBe(true);
  });

  it('describes times the way people say them', () => {
    const now = Date.parse('2026-01-10T12:00:00Z');
    expect(timeAgo('2026-01-10T11:59:30Z', now)).toBe('just now');
    expect(timeAgo('2026-01-10T11:45:00Z', now)).toBe('15 min ago');
    expect(timeAgo('2026-01-10T09:00:00Z', now)).toBe('3 h ago');
    expect(timeAgo('2026-01-09T10:00:00Z', now)).toBe('yesterday');
    expect(timeAgo('2026-01-05T10:00:00Z', now)).toBe('5 days ago');
  });
});

describe('proposals', () => {
  it('loads what is waiting for the open project', async () => {
    vi.mocked(apiListProposals).mockResolvedValue({ proposals: [proposal('a'), proposal('b')] });
    await store().load('p1');
    expect(store().proposals.map((p) => p.id)).toEqual(['a', 'b']);
  });

  it('applies on the proposal’s diagram, then marks it applied', async () => {
    useProposalsStore.setState({ projectId: 'p1', proposals: [proposal('a')] });
    await store().apply('a');
    expect(goToDiagram).toHaveBeenCalledWith('d-api');
    expect(loadDiagramElements).toHaveBeenCalledWith('d-api');
    expect(applyProposal).toHaveBeenCalledWith(
      expect.objectContaining({
        proposalId: 'a',
        changes: [{ action: 'add', elementType: 'rectangle', label: 'Payments' }],
      }),
      // Only onto that diagram: refused if the editor moved on meanwhile
      { diagramId: 'd-api' },
    );
    expect(apiResolveProposal).toHaveBeenCalledWith('a', 'applied', expect.any(String));
    expect(vi.mocked(applyProposal).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(apiResolveProposal).mock.invocationCallOrder[0],
    );
    expect(store().proposals).toEqual([]);
    expect(toasts()[0]).toBe('Applied: 1 added, 1 connected');
  });

  it('undoes its copy when someone else applied it a moment earlier', async () => {
    useProposalsStore.setState({ projectId: 'p1', proposals: [proposal('a')] });
    const undo = vi.spyOn(useElementsStore.getState(), 'undo').mockImplementation(() => {});
    vi.mocked(apiResolveProposal).mockRejectedValueOnce(new ApiError('taken', 409));
    await store().apply('a');
    expect(undo).toHaveBeenCalledTimes(1);
    expect(store().proposals).toEqual([]);
    expect(toasts()).toContain(
      'Someone else applied this proposal a moment earlier, so yours was undone',
    );
    undo.mockRestore();
  });

  it('never undoes an edit made after it, when it turns out someone else applied it', async () => {
    useProposalsStore.setState({ projectId: 'p1', proposals: [proposal('a')] });
    const undo = vi.spyOn(useElementsStore.getState(), 'undo').mockImplementation(() => {});
    vi.mocked(apiResolveProposal).mockImplementationOnce(async () => {
      // The person draws something while the server is asked
      useElementsStore.setState({ historyIndex: useElementsStore.getState().historyIndex + 1 });
      throw new ApiError('taken', 409);
    });
    await store().apply('a');
    expect(undo).not.toHaveBeenCalled();
    expect(toasts()).toContain(
      'Someone else applied this proposal a moment earlier: undo yours (Ctrl+Z) to avoid doubles',
    );
    undo.mockRestore();
  });

  it('asks again with the same key when the answer is lost', async () => {
    useProposalsStore.setState({ projectId: 'p1', proposals: [proposal('a')] });
    vi.mocked(apiResolveProposal).mockRejectedValueOnce(new TypeError('Failed to fetch'));
    await store().apply('a');
    const calls = vi.mocked(apiResolveProposal).mock.calls;
    expect(calls).toHaveLength(2);
    expect(calls[1]).toEqual(calls[0]);
    expect(toasts()[0]).toBe('Applied: 1 added, 1 connected');
  });

  it('leaves it waiting, with nothing marked, when applying fails', async () => {
    useProposalsStore.setState({ projectId: 'p1', proposals: [proposal('a')] });
    vi.mocked(goToDiagram).mockResolvedValueOnce(false);
    await store().apply('a');
    expect(apiResolveProposal).not.toHaveBeenCalled();
    expect(store().proposals.map((p) => p.id)).toEqual(['a']);
    expect(toasts()[0]).toContain('the diagram it changes no longer exists');
    expect(store().busyId).toBeNull();
  });

  it('never applies onto a diagram that did not load', async () => {
    useProposalsStore.setState({ projectId: 'p1', proposals: [proposal('a')] });
    vi.mocked(loadDiagramElements).mockRejectedValueOnce(new Error('502'));
    await store().apply('a');
    expect(applyProposal).not.toHaveBeenCalled();
    expect(apiResolveProposal).not.toHaveBeenCalled();
    expect(store().proposals.map((p) => p.id)).toEqual(['a']);
    expect(toasts()[0]).toContain('didn’t load');
  });

  it('dismisses without touching the map', async () => {
    useProposalsStore.setState({ projectId: 'p1', proposals: [proposal('a'), proposal('b')] });
    await store().dismiss('a');
    expect(apiResolveProposal).toHaveBeenCalledWith('a', 'dismissed');
    expect(applyProposal).not.toHaveBeenCalled();
    expect(store().proposals.map((p) => p.id)).toEqual(['b']);
  });

  it('ignores a stale load for a project that is no longer open', async () => {
    let resolve!: (v: { proposals: ProposalData[] }) => void;
    vi.mocked(apiListProposals).mockReturnValueOnce(new Promise((r) => (resolve = r)));
    const first = store().load('p1');
    vi.mocked(apiListProposals).mockResolvedValueOnce({ proposals: [] });
    await store().load('p2');
    resolve({ proposals: [proposal('old')] });
    await first;
    expect(store().projectId).toBe('p2');
    expect(store().proposals).toEqual([]);
  });
});
