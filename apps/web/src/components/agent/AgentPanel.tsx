import React, { useRef, useEffect, useState } from 'react';
import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport } from 'ai';
import { useUIStore } from '../../stores/uiStore';
import { useElementsStore } from '../../stores/elementsStore';
import { useDiagramStore } from '../../stores/diagramStore';
import { getAccessToken } from '../../services/api';
import { API_BASE } from '../../services/apiBase';
import { serializeScene } from '@mavisdraw/llm';
import type { MavisDrawScene, MavisElement, Diagram } from '@mavisdraw/types';
import ChatMessage from './ChatMessage';

function buildDiagramMarkdown(): string {
  const elementsState = useElementsStore.getState();
  const diagramState = useDiagramStore.getState();

  const elements: MavisElement[] = [];
  for (const el of elementsState.elements.values()) {
    if (!el.isDeleted) elements.push(el);
  }

  const diagrams: Diagram[] = [];
  for (const d of diagramState.diagrams.values()) {
    diagrams.push(d);
  }

  const scene: MavisDrawScene = {
    diagrams,
    elements,
    rootDiagramId: diagramState.activeDiagramId,
  };

  return serializeScene(scene);
}

/** Turn transport errors (often a JSON body) into a sentence for the user. */
function friendlyError(error: Error): string {
  try {
    const body = JSON.parse(error.message) as { error?: string };
    if (body.error) return body.error;
  } catch {
    // Not JSON
  }
  if (/fetch|network/i.test(error.message)) return 'Could not reach the AI service. Check your connection.';
  return error.message || 'The AI request failed.';
}

export default function AgentPanel() {
  const showAgentChat = useUIStore((s) => s.showAgentChat);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [inputText, setInputText] = useState('');

  // One transport for the panel's lifetime (not a new one per render)
  const [transport] = useState(
    () =>
      new DefaultChatTransport({
        api: `${API_BASE}/api/agent/chat`,
        credentials: 'include',
        headers: (): Record<string, string> => {
          const token = getAccessToken();
          return token ? { Authorization: `Bearer ${token}` } : {};
        },
        body: () => ({
          diagramMarkdown: buildDiagramMarkdown(),
        }),
      }),
  );
  const { messages, sendMessage, status, error, clearError } = useChat({ transport });

  const isStreaming = status === 'streaming' || status === 'submitted';

  // Auto-scroll on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const text = inputText.trim();
    if (!text || isStreaming) return;
    setInputText('');
    sendMessage({ text });
  };

  if (!showAgentChat) return null;

  return (
    <div className="w-80 border-l border-gray-200 bg-white flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-gray-200">
        <span className="text-sm font-medium text-gray-700">AI Chat</span>
        <button
          onClick={() => useUIStore.getState().toggleAgentChat()}
          className="text-gray-400 hover:text-gray-600 text-lg leading-none"
          title="Close"
        >
          &times;
        </button>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {messages.length === 0 && (
          <p className="text-xs text-gray-400 text-center mt-8">
            Ask me to describe, create, or modify your diagram. I can also browse linked GitHub
            repos.
          </p>
        )}
        {messages.map((m) => (
          <ChatMessage key={m.id} message={m} />
        ))}
        {error && (
          <div role="alert" className="rounded-md border border-red-200 bg-red-50 p-2 text-xs text-red-700">
            {friendlyError(error)}
            <button type="button" className="ml-2 underline" onClick={() => clearError()}>
              Dismiss
            </button>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <form onSubmit={handleSubmit} className="border-t border-gray-200 p-2 flex gap-2">
        <input
          value={inputText}
          onChange={(e) => setInputText(e.target.value)}
          placeholder="Ask about your diagram..."
          className="flex-1 text-sm px-3 py-1.5 border border-gray-300 rounded focus:outline-none focus:border-blue-500"
          disabled={isStreaming}
        />
        <button
          type="submit"
          disabled={isStreaming || !inputText.trim()}
          className="px-3 py-1.5 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed rounded"
        >
          Send
        </button>
      </form>
    </div>
  );
}
