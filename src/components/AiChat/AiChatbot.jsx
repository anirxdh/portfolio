import { useState, useEffect, useRef } from 'react';
import { useGSAP } from '@gsap/react';
import gsap from 'gsap';
import useAiChat from '../../hooks/useAiChat';
import useVoice from '../../hooks/useVoice';
import { ANIBOT_HASH, ANIBOT_OPEN_EVENT, takePendingOpen } from '../../data/anibotEvents';
import FloatingChatButton from './FloatingChatButton';
import ChatHeader from './ChatHeader';
import ChatMessages from './ChatMessages';
import ChatInput from './ChatInput';
import SuggestedQuestions from './SuggestedQuestions';
import FollowUps from './FollowUps';

const AiChatbot = () => {
  const [isOpen, setIsOpen] = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(true);
  const { messages, isLoading, isStreaming, mode, sendMessage } = useAiChat();
  // Typing stays allowed while a reply streams in; sending waits until it finishes.
  const busy = isLoading || isStreaming;

  // Other parts of the page (the command palette, links to /#anibot) can open the chat,
  // optionally with a question to ask right away. See src/data/anibotEvents.js.
  useEffect(() => {
    const openWith = (question) => {
      setIsOpen(true);
      if (question) {
        setShowSuggestions(false);
        sendMessage(question);
      }
    };
    const onOpen = (e) => {
      takePendingOpen();
      openWith(e.detail?.question);
    };
    const onHash = () => {
      if (window.location.hash !== ANIBOT_HASH) return;
      openWith();
      // Drop the hash so the same link opens the chat again next time.
      window.history.replaceState(null, '', window.location.pathname + window.location.search);
    };
    const pending = takePendingOpen();
    if (pending) openWith(pending.question);
    else onHash();
    window.addEventListener(ANIBOT_OPEN_EVENT, onOpen);
    window.addEventListener('hashchange', onHash);
    return () => {
      window.removeEventListener(ANIBOT_OPEN_EVENT, onOpen);
      window.removeEventListener('hashchange', onHash);
    };
  }, [sendMessage]);
  const [voiceReplies, setVoiceReplies] = useState(false);
  const voice = useVoice({
    // Talking to AniBot implies you want to hear it back.
    onFinalTranscript: (text) => {
      setVoiceReplies(true);
      sendMessage(text);
      setShowSuggestions(false);
    },
  });

  // Speak each finished assistant reply when spoken replies are on.
  const wasStreaming = useRef(false);
  useEffect(() => {
    if (wasStreaming.current && !isStreaming && voiceReplies) {
      const last = messages[messages.length - 1];
      if (last?.role === 'assistant' && last.id !== 'welcome') voice.speak(last.content);
    }
    wasStreaming.current = isStreaming;
  }, [isStreaming, voiceReplies, messages, voice]);
  const windowRef = useRef(null);

  // Move focus into the dialog when it opens so screen readers announce it.
  useEffect(() => {
    if (isOpen) windowRef.current?.focus();
  }, [isOpen]);

  // GSAP animation for chat window
  useGSAP(() => {
    if (isOpen) {
      gsap.fromTo(
        '.chat-window',
        {
          opacity: 0,
          y: 20,
          scale: 0.95,
        },
        {
          opacity: 1,
          y: 0,
          scale: 1,
          duration: 0.3,
          ease: 'power2.out',
        }
      );
    }
  }, [isOpen]);

  const handleOpen = () => {
    setIsOpen(true);
  };

  const handleClose = () => {
    voice.stopListening();
    voice.stopSpeaking();
    setIsOpen(false);
  };

  const handleMinimize = () => {
    setIsOpen(false);
  };

  const handleSend = (message) => {
    sendMessage(message);
    setShowSuggestions(false);
  };

  const handleSuggestedQuestion = (question) => {
    sendMessage(question);
    setShowSuggestions(false);
  };

  const handleContact = () => {
    setIsOpen(false);
    const el = document.getElementById('contact');
    if (el) el.scrollIntoView({ behavior: 'smooth' });
  };

  // Answers link to homepage sections ("/#contact", "/#work"). Follow those in place: close the
  // chat and scroll, instead of reloading the page.
  const handleLinkClick = (e) => {
    const a = e.target.closest?.('a[href]');
    const m = a && /^\/?#([\w-]+)$/.exec(a.getAttribute('href'));
    const el = m && m[1] !== ANIBOT_HASH.slice(1) && document.getElementById(m[1]);
    if (!el) return;
    e.preventDefault();
    setIsOpen(false);
    el.scrollIntoView({ behavior: 'smooth' });
    window.history.replaceState(null, '', `#${m[1]}`);
  };

  const hasAssistantReply = messages.some(
    (msg) => msg.role === 'assistant' && msg.id !== 'welcome',
  );

  // Hide suggestions after first user message
  useEffect(() => {
    const userMessages = messages.filter(msg => msg.role === 'user');
    if (userMessages.length > 0) {
      setShowSuggestions(false);
    }
  }, [messages]);

  return (
    <>
      {/* Floating button - always visible when chat is closed */}
      {!isOpen && <FloatingChatButton onClick={handleOpen} />}

      {/* Chat window */}
      {isOpen && (
        <div
          ref={windowRef}
          role="dialog"
          aria-modal="true"
          aria-label="Chat with AniBot"
          tabIndex={-1}
          onKeyDown={(e) => {
            if (e.key === 'Escape') handleClose();
          }}
          onClick={handleLinkClick}
          className="chat-window fixed bottom-6 right-6 w-[400px] max-w-[calc(100vw-3rem)] h-[600px] max-h-[calc(100vh-3rem)] bg-black-200 border border-black-300 rounded-lg shadow-2xl flex flex-col z-50 backdrop-blur-sm focus:outline-none">
          <ChatHeader
            onClose={handleClose}
            onMinimize={handleMinimize}
            mode={mode}
            canSpeak={voice.canSpeak}
            voiceReplies={voiceReplies}
            onToggleVoice={() => {
              if (voiceReplies) voice.stopSpeaking();
              setVoiceReplies((v) => !v);
            }}
          />

          <ChatMessages messages={messages} isLoading={isLoading} />

          {showSuggestions && messages.length <= 1 && !busy && (
            <SuggestedQuestions
              onQuestionClick={handleSuggestedQuestion}
              disabled={busy}
            />
          )}

          {hasAssistantReply && !busy && (
            <FollowUps
              onQuestionClick={handleSuggestedQuestion}
              onContact={handleContact}
              disabled={busy}
            />
          )}

          <ChatInput onSend={handleSend} disabled={isLoading} busy={isStreaming} voice={voice} />
        </div>
      )}

      {/* Mobile overlay backdrop */}
      {isOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-40 md:hidden"
          onClick={handleClose}
        />
      )}

    </>
  );
};

export default AiChatbot;

