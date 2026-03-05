import { describe, it, expect } from 'vitest';
import { buildSystemPrompt, buildTools } from '../services/agentService.js';
import type { DiagramProposal } from '@mavisdraw/types';

describe('agentService', () => {
  describe('buildSystemPrompt', () => {
    it('includes the diagram markdown', () => {
      const prompt = buildSystemPrompt('# Architecture: Test\n\n## Elements\n- [rectangle] "API"');
      expect(prompt).toContain('# Architecture: Test');
      expect(prompt).toContain('[rectangle] "API"');
    });

    it('shows empty diagram message when markdown is empty', () => {
      const prompt = buildSystemPrompt('');
      expect(prompt).toContain('(empty diagram)');
    });

    it('contains role description', () => {
      const prompt = buildSystemPrompt('test');
      expect(prompt).toContain('MavisDraw AI');
      expect(prompt).toContain('architecture diagram assistant');
    });

    it('describes available tools', () => {
      const prompt = buildSystemPrompt('test');
      expect(prompt).toContain('browse_diagram');
      expect(prompt).toContain('browse_code');
      expect(prompt).toContain('read_file');
      expect(prompt).toContain('propose_changes');
    });
  });

  describe('buildTools', () => {
    it('returns all four tools', () => {
      const tools = buildTools('user-1', '# Test');
      expect(Object.keys(tools)).toEqual(
        expect.arrayContaining(['browse_diagram', 'browse_code', 'read_file', 'propose_changes']),
      );
      expect(Object.keys(tools)).toHaveLength(4);
    });

    it('browse_diagram returns the diagram markdown', async () => {
      const tools = buildTools('user-1', '# Architecture: My App');
      const execCtx = {
        toolCallId: 'tc1',
        messages: [] as never,
        abortSignal: new AbortController().signal,
      };
      const result = (await tools.browse_diagram.execute!({}, execCtx)) as {
        diagram: string;
      };
      expect(result.diagram).toBe('# Architecture: My App');
    });

    it('browse_diagram returns empty message for empty diagram', async () => {
      const tools = buildTools('user-1', '');
      const execCtx = {
        toolCallId: 'tc1',
        messages: [] as never,
        abortSignal: new AbortController().signal,
      };
      const result = (await tools.browse_diagram.execute!({}, execCtx)) as {
        diagram: string;
      };
      expect(result.diagram).toBe('(empty diagram)');
    });

    it('propose_changes returns a structured proposal', async () => {
      const tools = buildTools('user-1', '# Test');
      const execCtx = {
        toolCallId: 'tc2',
        messages: [] as never,
        abortSignal: new AbortController().signal,
      };
      const result = (await tools.propose_changes.execute!(
        {
          description: 'Add database',
          changes: [
            { action: 'add' as const, elementType: 'rectangle' as const, label: 'Database' },
          ],
          connections: [{ fromLabel: 'API', toLabel: 'Database', label: 'SQL' }],
        },
        execCtx,
      )) as DiagramProposal;

      expect(result).toMatchObject({
        description: 'Add database',
        status: 'pending',
        changes: [{ action: 'add', elementType: 'rectangle', label: 'Database' }],
        connections: [{ fromLabel: 'API', toLabel: 'Database', label: 'SQL' }],
      });
      expect(result.proposalId).toBeTruthy();
    });
  });
});
