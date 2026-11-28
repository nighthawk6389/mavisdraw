import type { LanguageModel } from 'ai';

/**
 * A deterministic stand-in for the LLM, used only when AGENT_MOCK=1 outside
 * production. It lets the full chat pipeline (HTTP, streaming, CORS, tool
 * calls, proposal UI) be exercised end-to-end in tests without an API key.
 *
 * First turn: calls `propose_changes` with a small architecture built from the
 * user's message. After the tool result: replies with a short summary.
 *
 * "read owner/name:path" instead calls `read_file` there, and then repeats
 * what the tool answered (the file, or why it couldn't be read).
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
      // Only what came after the latest question counts (the chat keeps history)
      const lastUser = prompt.map((m) => m.role).lastIndexOf('user');
      const sinceQuestion = prompt.slice(lastUser + 1);
      const hasToolResult = sinceQuestion.some(
        (m) => m.role === 'tool' || (Array.isArray(m.content) && m.content.some((p) => p.type === 'tool-result')),
      );
      const question = prompt[lastUser];
      const questionText =
        question && Array.isArray(question.content)
          ? question.content.map((p) => (p.type === 'text' ? p.text : '')).join('')
          : '';
      const readAsk = questionText.match(/^read (\S+?):(\S+)/);

      if (readAsk && hasToolResult) {
        const toolMessage = sinceQuestion.find((m) => m.role === 'tool');
        const result = Array.isArray(toolMessage?.content)
          ? toolMessage.content.find((p) => p.type === 'tool-result')
          : undefined;
        const output = result && 'output' in result ? (result.output as { value?: unknown }) : undefined;
        const value = (output?.value ?? {}) as { content?: string; error?: string };
        const text = value.error ? `Couldn't read it: ${value.error}` : `It says: ${value.content ?? ''}`;
        return {
          stream: simulateReadableStream({
            chunks: [
              { type: 'stream-start', warnings: [] },
              { type: 'text-start', id: 't1' },
              { type: 'text-delta', id: 't1', delta: text },
              { type: 'text-end', id: 't1' },
              { type: 'finish', usage, finishReason: { unified: 'stop', raw: 'end_turn' } },
            ],
          }),
        };
      }

      if (readAsk) {
        const input = JSON.stringify({ repository: readAsk[1], path: readAsk[2] });
        return {
          stream: simulateReadableStream({
            chunks: [
              { type: 'stream-start', warnings: [] },
              { type: 'tool-call', toolCallId: 'call-read', toolName: 'read_file', input },
              { type: 'finish', usage, finishReason: { unified: 'tool-calls', raw: 'tool_use' } },
            ],
          }),
        };
      }

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
