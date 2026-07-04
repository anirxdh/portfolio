import { useState, useCallback } from 'react';

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

  const sendMessage = useCallback(async (userMessage) => {
    if (!userMessage.trim() || isLoading) return;

    const userMsg = {
      id: Date.now().toString(),
      role: 'user',
      content: userMessage,
      timestamp: new Date(),
    };

    setMessages(prev => [...prev, userMsg]);
    setIsLoading(true);
    setError(null);

    try {
      const conversationHistory = messages
        .filter(msg => msg.id !== 'welcome')
        .slice(-10)
        .map(msg => ({
          role: msg.role,
          content: msg.content,
        }));

      const response = await fetch(API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          message: userMessage,
          conversationHistory,
        }),
      });

      if (!response.ok) {
        throw new Error(`API error: ${response.status}`);
      }

      const data = await response.json();

      // Add the assistant response (rendered as Markdown in ChatMessage).
      const assistantMsg = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: data.response || '',
        timestamp: new Date(),
        contextsUsed: data.contextsUsed,
      };

      setMessages(prev => [...prev, assistantMsg]);
    } catch (err) {
      console.error('Chat error:', err);
      setError('Failed to get response. Please try again.');

      const errorMsg = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: "I'm sorry, I'm having trouble connecting right now. Please try again in a moment, or feel free to reach out directly via the contact form below!",
        timestamp: new Date(),
        isError: true,
      };

      setMessages(prev => [...prev, errorMsg]);
    } finally {
      setIsLoading(false);
    }
  }, [messages, isLoading]);

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
