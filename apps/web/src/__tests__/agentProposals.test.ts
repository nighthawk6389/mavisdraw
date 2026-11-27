import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mcpSetup, timeAgo } from '../components/agent/mcpSetup';
import { useProposalsStore } from '../stores/proposalsStore';
import { useToastStore } from '../stores/toastStore';
import { ApiError, apiListProposals, apiResolveProposal, type ProposalData } from '../services/api';
import { goToDiagram } from '../services/diagramSync';
import { applyProposal } from '../components/agent/applyProposal';

vi.mock('../services/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../services/api')>()),
  apiListProposals: vi.fn(),
  apiResolveProposal: vi.fn(),
}));
vi.mock('../services/diagramSync', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../services/diagramSync')>()),
  goToDiagram: vi.fn(async () => true),
}));
vi.mock('../components/agent/applyProposal', () => ({
  applyProposal: vi.fn(async () => ({ added: 1, modified: 0, deleted: 0, connected: 1 })),
}));

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

  it('applies on the proposal’s diagram after claiming it', async () => {
    useProposalsStore.setState({ projectId: 'p1', proposals: [proposal('a')] });
    await store().apply('a');
    expect(apiResolveProposal).toHaveBeenCalledWith('a', 'applied');
    expect(goToDiagram).toHaveBeenCalledWith('d-api');
    expect(applyProposal).toHaveBeenCalledWith(
      expect.objectContaining({
        proposalId: 'a',
        changes: [{ action: 'add', elementType: 'rectangle', label: 'Payments' }],
      }),
    );
    expect(store().proposals).toEqual([]);
    expect(toasts()[0]).toBe('Applied: 1 added, 1 connected');
  });

  it('does nothing when someone else already handled it', async () => {
    useProposalsStore.setState({ projectId: 'p1', proposals: [proposal('a')] });
    vi.mocked(apiResolveProposal).mockRejectedValueOnce(new ApiError('taken', 409));
    await store().apply('a');
    expect(applyProposal).not.toHaveBeenCalled();
    expect(store().proposals).toEqual([]);
    expect(toasts()).toContain('Someone already handled this proposal');
  });

  it('puts it back in the queue when applying fails', async () => {
    useProposalsStore.setState({ projectId: 'p1', proposals: [proposal('a')] });
    vi.mocked(goToDiagram).mockResolvedValueOnce(false);
    await store().apply('a');
    expect(apiResolveProposal).toHaveBeenLastCalledWith('a', 'pending');
    expect(store().proposals.map((p) => p.id)).toEqual(['a']);
    expect(toasts()[0]).toContain('the diagram it changes no longer exists');
    expect(store().busyId).toBeNull();
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
