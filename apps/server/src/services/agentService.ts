import { anthropic } from '@ai-sdk/anthropic';
import { streamText, stepCountIs } from 'ai';
import { tool, zodSchema } from 'ai';
import { z } from 'zod';
import { nanoid } from 'nanoid';
import { getDecryptedToken, getRepoTree, getFileContent } from './githubService.js';
import type { DiagramProposal } from '@mavisdraw/types';

// ── Model ──────────────────────────────────────────────────

const model = anthropic('claude-sonnet-4-20250514');

// ── System Prompt ──────────────────────────────────────────

export function buildSystemPrompt(diagramMarkdown: string): string {
  return `You are MavisDraw AI, an architecture diagram assistant. You help users understand, create, and modify architecture diagrams.

## Current Diagram

${diagramMarkdown || '(empty diagram)'}

## Rules

1. **Always browse before proposing**: When the user asks you to modify the diagram based on code, use \`browse_code\` and \`read_file\` to understand the codebase first.
2. **Reference elements by label**: When modifying existing elements, refer to them by their label text as shown in the diagram above.
3. **Use propose_changes for all modifications**: Never describe changes in text — always use the \`propose_changes\` tool so the user can review and apply them.
4. **Keep proposals focused**: Each proposal should represent one logical change. If the user asks for multiple unrelated changes, make separate proposals.
5. **Supported element types**: rectangle, ellipse, diamond, portal, arrow. Use rectangle for most services/components.
6. **Connection labels**: Use short labels on connections to describe the relationship (e.g., "REST", "gRPC", "publishes", "subscribes").

## Available Tools

- \`browse_diagram\`: View the current diagram structure
- \`browse_code\`: List files/directories in a linked GitHub repository
- \`read_file\`: Read a specific file from a linked GitHub repository
- \`propose_changes\`: Propose additions, modifications, or deletions to the diagram`;
}

// ── Zod Schemas ────────────────────────────────────────────

const browseDiagramSchema = z.object({});

const browseCodeSchema = z.object({
  connectionId: z.string().describe('The GitHub connection ID'),
  owner: z.string().describe('Repository owner'),
  repo: z.string().describe('Repository name'),
  path: z.string().optional().describe('Directory path (empty for root)'),
  ref: z.string().optional().describe('Branch or commit ref (default: HEAD)'),
});

const readFileSchema = z.object({
  connectionId: z.string().describe('The GitHub connection ID'),
  owner: z.string().describe('Repository owner'),
  repo: z.string().describe('Repository name'),
  path: z.string().describe('File path'),
  ref: z.string().optional().describe('Branch or commit ref (default: HEAD)'),
});

const proposeChangesSchema = z.object({
  description: z.string().describe('Brief description of what this proposal does'),
  changes: z.array(
    z.discriminatedUnion('action', [
      z.object({
        action: z.literal('add'),
        elementType: z
          .enum(['rectangle', 'ellipse', 'diamond', 'portal', 'arrow'])
          .describe('Type of element to add'),
        label: z.string().describe('Label text for the element'),
        properties: z.record(z.unknown()).optional(),
      }),
      z.object({
        action: z.literal('modify'),
        elementId: z.string().describe('ID of the element to modify'),
        label: z.string().optional().describe('New label text'),
        properties: z.record(z.unknown()).optional(),
      }),
      z.object({
        action: z.literal('delete'),
        elementId: z.string().describe('ID of the element to delete'),
      }),
    ]),
  ),
  connections: z
    .array(
      z.object({
        fromLabel: z.string().describe('Label of the source element'),
        toLabel: z.string().describe('Label of the target element'),
        label: z.string().optional().describe('Connection label'),
      }),
    )
    .optional()
    .default([]),
});

// ── Tool Definitions ───────────────────────────────────────

export function buildTools(userId: string, diagramMarkdown: string) {
  return {
    browse_diagram: tool({
      description: 'View the current diagram structure in LLM-readable format',
      inputSchema: zodSchema(browseDiagramSchema),
      execute: async () => {
        try {
          return { diagram: diagramMarkdown || '(empty diagram)' };
        } catch (err) {
          console.error('[agentService] browse_diagram failed:', err);
          return { error: String(err) };
        }
      },
    }),

    browse_code: tool({
      description:
        'List files and directories in a linked GitHub repository. Use this to navigate the codebase.',
      inputSchema: zodSchema(browseCodeSchema),
      execute: async ({
        connectionId,
        owner,
        repo,
        path,
        ref,
      }: z.infer<typeof browseCodeSchema>) => {
        try {
          const { accessToken, enterpriseUrl } = await getDecryptedToken(connectionId, userId);
          const entries = await getRepoTree(
            accessToken,
            owner,
            repo,
            ref ?? 'HEAD',
            path ?? '',
            enterpriseUrl,
          );
          return {
            entries: entries.map((e) => ({
              path: e.path,
              type: e.type,
              size: e.size,
            })),
          };
        } catch (err) {
          console.error('[agentService] browse_code failed:', err);
          return { error: err instanceof Error ? err.message : String(err) };
        }
      },
    }),

    read_file: tool({
      description: 'Read the contents of a file from a linked GitHub repository.',
      inputSchema: zodSchema(readFileSchema),
      execute: async ({
        connectionId,
        owner,
        repo,
        path,
        ref,
      }: z.infer<typeof readFileSchema>) => {
        try {
          const { accessToken, enterpriseUrl } = await getDecryptedToken(connectionId, userId);
          const file = await getFileContent(
            accessToken,
            owner,
            repo,
            path,
            ref ?? 'HEAD',
            enterpriseUrl,
          );
          // Truncate very large files
          const content =
            file.content.length > 50_000
              ? file.content.slice(0, 50_000) + '\n\n[...truncated]'
              : file.content;
          return { path, content, size: file.size };
        } catch (err) {
          console.error('[agentService] read_file failed:', err);
          return { error: err instanceof Error ? err.message : String(err) };
        }
      },
    }),

    propose_changes: tool({
      description:
        'Propose changes to the diagram. The user will review and can apply them with one click.',
      inputSchema: zodSchema(proposeChangesSchema),
      execute: async ({
        description,
        changes,
        connections,
      }: z.infer<typeof proposeChangesSchema>): Promise<DiagramProposal> => {
        return {
          proposalId: nanoid(),
          description,
          changes,
          connections,
          status: 'pending',
        };
      },
    }),
  };
}

// ── Stream Chat ────────────────────────────────────────────

export function streamAgentChat(
  messages: import('ai').ModelMessage[],
  userId: string,
  diagramMarkdown: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): any {
  const tools = buildTools(userId, diagramMarkdown);
  return streamText({
    model,
    system: buildSystemPrompt(diagramMarkdown),
    messages,
    tools,
    stopWhen: stepCountIs(10),
  });
}
