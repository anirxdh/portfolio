import { useState, useCallback, useRef } from 'react';

const API_URL = import.meta.env.VITE_CHAT_API_URL || '/api/chat';

const WELCOME_MESSAGE = "Hey! I'm AniBot 👋 — Anirudh's AI assistant.\n\nAsk me anything about his work at Rivo, his AI agent & RAG projects, hackathons (including the YC AI Hackathon), or how to get in touch. What would you like to know?";

export const useAiChat = () => {
  const [messages, setMessages] = useState([
    {
      id: 'welcome',
      role: 'assistant',
      content: WELCOME_MESSAGE,
      timestamp: new Date(),
    },
  ]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);

  // Always read the latest messages without re-creating sendMessage every render.
  const messagesRef = useRef(messages);
  messagesRef.current = messages;

  const sendMessage = useCallback(async (userMessage) => {
    if (!userMessage.trim() || isLoading) return;

    const userMsg = {
      id: Date.now().toString(),
      role: 'user',
      content: userMessage,
      timestamp: new Date(),
    };

    setMessages((prev) => [...prev, userMsg]);
    setIsLoading(true);
    setError(null);

    try {
      const conversationHistory = messagesRef.current
        .filter((msg) => msg.id !== 'welcome')
        .slice(-10)
        .map((msg) => ({ role: msg.role, content: msg.content }));

      const response = await fetch(API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: userMessage, conversationHistory }),
      });

      if (!response.ok || !response.body) {
        throw new Error(`API error: ${response.status}`);
      }

      // Stream the response token-by-token as it arrives from the server.
      const assistantId = (Date.now() + 1).toString();
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let acc = '';
      let created = false;
      let lastFlush = 0;

      const flush = () => {
        const text = acc;
        setMessages((prev) => prev.map((m) => (m.id === assistantId ? { ...m, content: text } : m)));
      };

      // eslint-disable-next-line no-constant-condition
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        acc += decoder.decode(value, { stream: true });

        if (!created && acc.trim()) {
          created = true;
          setIsLoading(false); // hide the typing dots once real text starts flowing
          setMessages((prev) => [
            ...prev,
            { id: assistantId, role: 'assistant', content: acc, timestamp: new Date() },
          ]);
          lastFlush = performance.now();
        } else if (created) {
          const now = performance.now();
          if (now - lastFlush > 40) {
            lastFlush = now;
            flush();
          }
        }
      }

      if (!created) {
        // Empty stream — still show something rather than nothing.
        setMessages((prev) => [
          ...prev,
          {
            id: assistantId,
            role: 'assistant',
            content: acc || "Sorry, I didn't catch that — could you rephrase?",
            timestamp: new Date(),
          },
        ]);
      } else {
        flush(); // ensure the final, complete text is shown
      }
    } catch (err) {
      console.error('Chat error:', err);
      setError('Failed to get response. Please try again.');

      const errorMsg = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content:
          "I'm sorry, I'm having trouble connecting right now. Please try again in a moment, or feel free to reach out directly via the contact form below!",
        timestamp: new Date(),
        isError: true,
      };

      setMessages((prev) => [...prev, errorMsg]);
    } finally {
      setIsLoading(false);
    }
  }, [isLoading]);

  const clearMessages = useCallback(() => {
    setMessages([
      {
        id: 'welcome',
        role: 'assistant',
        content: WELCOME_MESSAGE,
        timestamp: new Date(),
      },
    ]);
    setError(null);
  }, []);

  return {
    messages,
    isLoading,
    error,
    sendMessage,
    clearMessages,
  };
};

export default useAiChat;
