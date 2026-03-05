import React, { useRef, useEffect, useState } from 'react';
import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport } from 'ai';
import { useUIStore } from '../../stores/uiStore';
import { useElementsStore } from '../../stores/elementsStore';
import { useDiagramStore } from '../../stores/diagramStore';
import { getAccessToken } from '../../services/api';
import { serializeScene } from '@mavisdraw/llm';
import type { MavisDrawScene, MavisElement, Diagram } from '@mavisdraw/types';
import ChatMessage from './ChatMessage';

const API_BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:3001';

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

export default function AgentPanel() {
  const showAgentChat = useUIStore((s) => s.showAgentChat);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [inputText, setInputText] = useState('');

  const { messages, sendMessage, status } = useChat({
    transport: new DefaultChatTransport({
      api: `${API_BASE}/api/agent/chat`,
      headers: (): Record<string, string> => {
        const token = getAccessToken();
        return token ? { Authorization: `Bearer ${token}` } : {};
      },
      body: () => ({
        diagramMarkdown: buildDiagramMarkdown(),
      }),
    }),
  });

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
