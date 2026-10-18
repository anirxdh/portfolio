import { useState, useCallback, useRef } from 'react';

const API_URL = import.meta.env.VITE_CHAT_API_URL || '/api/chat';
// Written at build time by scripts/build-anibot-kb.mjs. Same value as KB_URL in src/data/anibotLocal.js,
// repeated here so the knowledge base and the engine chunk can download in parallel.
const KB_URL = '/anibot-kb.json';
// Give up on the live AI if it has not started answering by then.
const FIRST_BYTE_TIMEOUT_MS = 15000;
// After a failure, answer from notes for a while before trying the live AI again.
const RETRY_LIVE_AFTER_MS = 60000;
// Pace for showing a notes answer line by line, so it reads like the streamed replies.
const LINE_DELAY_MS = 45;

const WELCOME_MESSAGE = "Hey! I'm AniBot 👋, Anirudh's AI assistant.\n\nAsk me anything about his work at Rivo, his AI agent & RAG projects, hackathons (including the YC AI Hackathon), or how to get in touch. What would you like to know?";
const ERROR_MESSAGE =
  "I'm sorry, I'm having trouble connecting right now. Please try again in a moment, or reach out through the contact form below.";

const welcome = () => ({ id: 'welcome', role: 'assistant', content: WELCOME_MESSAGE, timestamp: new Date() });

let idCounter = 0;
const newId = () => `${Date.now()}-${(idCounter += 1)}`;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const prefersReducedMotion = () =>
  typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

// The offline engine and its knowledge base load once, on the first failure, then stay in memory.
let notesPromise = null;
const loadNotes = () => {
  if (!notesPromise) {
    notesPromise = Promise.all([
      import('../data/anibotLocal.js'),
      fetch(KB_URL).then((r) => {
        if (!r.ok) throw new Error(`Knowledge base: ${r.status}`);
        return r.json();
      }),
    ])
      .then(([engine, kb]) => ({ engine, index: engine.buildIndex(kb) }))
      .catch((err) => {
        notesPromise = null; // let the next message try again
        throw err;
      });
  }
  return notesPromise;
};

export const useAiChat = () => {
  const [messages, setMessages] = useState(() => [welcome()]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);
  const [isStreaming, setIsStreaming] = useState(false);
  // 'live' while the LLM answers, 'notes' while AniBot answers from the local knowledge base.
  const [mode, setMode] = useState('live');

  // Always read the latest messages without re-creating sendMessage every render.
  const messagesRef = useRef(messages);
  messagesRef.current = messages;
  const busyRef = useRef(false);
  const liveRetryAtRef = useRef(0);
  const seenRef = useRef(new Set());

  const addMessage = (msg) => setMessages((prev) => [...prev, msg]);
  const patchMessage = (id, patch) => setMessages((prev) => prev.map((m) => (m.id === id ? { ...m, ...patch } : m)));

  // Streams a reply from /api/chat. Resolves to the reply ({ id, content }) once it is on screen, or
  // null when the live AI failed before saying anything (non-2xx, network error, timeout, empty stream).
  const streamLive = async (text, conversationHistory) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FIRST_BYTE_TIMEOUT_MS);
    let response;
    try {
      response = await fetch(API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text, conversationHistory }),
        signal: controller.signal,
      });
    } catch (err) {
      console.warn('AniBot live AI unreachable, answering from notes.', err);
      return null;
    } finally {
      clearTimeout(timer);
    }
    if (!response.ok || !response.body) {
      console.warn(`AniBot live AI returned ${response.status}, answering from notes.`);
      return null;
    }

    // Stream the response token by token as it arrives from the server.
    const assistantId = newId();
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let acc = '';
    let created = false;
    let lastFlush = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        acc += decoder.decode(value, { stream: true });
        if (!created && acc.trim()) {
          created = true;
          setIsLoading(false); // hide the typing dots once real text starts flowing
          addMessage({ id: assistantId, role: 'assistant', content: acc, timestamp: new Date() });
          lastFlush = performance.now();
        } else if (created && performance.now() - lastFlush > 40) {
          lastFlush = performance.now();
          patchMessage(assistantId, { content: acc });
        }
      }
    } catch (err) {
      // A stream that breaks after real text keeps what arrived; one that breaks before falls back.
      console.warn('AniBot stream interrupted.', err);
    }
    if (!created) return null;
    patchMessage(assistantId, { content: acc });
    return { id: assistantId, content: acc };
  };

  // Answers from the build-time knowledge base and shows the reply a line at a time. Resolves to the
  // reply ({ id, content }); the "from my notes" footnote rides along as `note`, outside the content.
  const answerFromNotes = async (text, previousQuestions) => {
    const { engine, index } = await loadNotes();
    const reply = engine.answerLocally(index, text, { previous: previousQuestions, seen: seenRef.current });
    reply.ids.forEach((id) => seenRef.current.add(id));

    const id = newId();
    const lines = reply.text.split('\n');
    setIsLoading(false);
    if (prefersReducedMotion() || lines.length < 3) {
      addMessage({ id, role: 'assistant', content: reply.text, note: reply.note, source: 'notes', timestamp: new Date() });
      return { id, content: reply.text };
    }
    addMessage({ id, role: 'assistant', content: lines[0], source: 'notes', timestamp: new Date() });
    for (let i = 2; i <= lines.length; i += 1) {
      await sleep(LINE_DELAY_MS);
      patchMessage(id, { content: lines.slice(0, i).join('\n') });
    }
    patchMessage(id, { note: reply.note });
    return { id, content: reply.text };
  };

  // Sends one question and resolves to the assistant message it produced: { id, content, isError }.
  // Only one request runs at a time; while one is in flight this resolves to null and sends nothing
  // (check isBusy() first if the text must not be lost).
  const sendMessage = useCallback(async (userMessage) => {
    const text = String(userMessage || '').trim();
    if (!text || busyRef.current) return null;
    busyRef.current = true;
    let reply = null;

    // Snapshot before this message lands in state.
    const prior = messagesRef.current.filter((m) => m.id !== 'welcome' && !m.isError);
    const conversationHistory = prior.slice(-10).map((m) => ({ role: m.role, content: m.content }));
    const previousQuestions = prior.filter((m) => m.role === 'user').slice(-3).map((m) => m.content);

    addMessage({ id: newId(), role: 'user', content: text, timestamp: new Date() });
    setIsLoading(true);
    setIsStreaming(true);
    setError(null);

    try {
      const online = typeof navigator === 'undefined' || navigator.onLine !== false;
      if (online && Date.now() >= liveRetryAtRef.current) {
        reply = await streamLive(text, conversationHistory);
        if (reply) setMode('live');
      }
      if (!reply) {
        liveRetryAtRef.current = Date.now() + RETRY_LIVE_AFTER_MS;
        reply = await answerFromNotes(text, previousQuestions);
        setMode('notes');
      }
      reply = { ...reply, isError: false };
    } catch (err) {
      console.error('Chat error:', err);
      setError('Failed to get response. Please try again.');
      reply = { id: newId(), content: ERROR_MESSAGE, isError: true };
      addMessage({ ...reply, role: 'assistant', timestamp: new Date() });
    } finally {
      setIsLoading(false);
      setIsStreaming(false);
      busyRef.current = false;
    }
    return reply;
    // streamLive and answerFromNotes only touch refs and state setters, so this stays stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const isBusy = useCallback(() => busyRef.current, []);

  const clearMessages = useCallback(() => {
    setMessages([welcome()]);
    setError(null);
    seenRef.current = new Set();
  }, []);

  return {
    messages,
    isLoading,
    isStreaming,
    error,
    mode,
    sendMessage,
    isBusy,
    clearMessages,
  };
};

export default useAiChat;
