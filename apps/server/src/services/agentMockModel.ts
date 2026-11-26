import type { LanguageModel } from 'ai';

/**
 * A deterministic stand-in for the LLM, used only when AGENT_MOCK=1 outside
 * production. It lets the full chat pipeline (HTTP, streaming, CORS, tool
 * calls, proposal UI) be exercised end-to-end in tests without an API key.
 *
 * First turn: calls `propose_changes` with a small architecture built from the
 * user's message. After the tool result: replies with a short summary.
 */
export async function createMockAgentModel(): Promise<LanguageModel> {
  const { MockLanguageModelV3, simulateReadableStream } = await import('ai/test');

  const usage = {
    inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 },
    outputTokens: { total: 20, text: 20, reasoning: 0 },
  };

  return new MockLanguageModelV3({
    modelId: 'mock-architect',
    doStream: async (options) => {
      const prompt = options.prompt;
      const hasToolResult = prompt.some(
        (m) => m.role === 'tool' || (Array.isArray(m.content) && m.content.some((p) => p.type === 'tool-result')),
      );

      if (hasToolResult) {
        return {
          stream: simulateReadableStream({
            chunks: [
              { type: 'stream-start', warnings: [] },
              { type: 'text-start', id: 't1' },
              { type: 'text-delta', id: 't1', delta: 'I proposed a cache in front of the API. ' },
              { type: 'text-delta', id: 't1', delta: 'Review it and click Apply.' },
              { type: 'text-end', id: 't1' },
              { type: 'finish', usage, finishReason: { unified: 'stop', raw: 'end_turn' } },
            ],
          }),
        };
      }

      const input = JSON.stringify({
        description: 'Add a cache in front of the API',
        changes: [
          { action: 'add', elementType: 'rectangle', label: 'API' },
          { action: 'add', elementType: 'rectangle', label: 'Redis Cache' },
          { action: 'add', elementType: 'rectangle', label: 'Orders DB' },
        ],
        connections: [
          { fromLabel: 'API', toLabel: 'Redis Cache', label: 'reads' },
          { fromLabel: 'Redis Cache', toLabel: 'Orders DB', label: 'on miss' },
        ],
      });

      return {
        stream: simulateReadableStream({
          chunks: [
            { type: 'stream-start', warnings: [] },
            { type: 'tool-call', toolCallId: 'call-1', toolName: 'propose_changes', input },
            { type: 'finish', usage, finishReason: { unified: 'tool-calls', raw: 'tool_use' } },
          ],
        }),
      };
    },
  }) as unknown as LanguageModel;
}
