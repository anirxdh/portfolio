import { useState, useEffect, useRef, useCallback } from 'react';
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
  const { messages, isLoading, isStreaming, mode, sendMessage, isBusy } = useAiChat();
  // Typing stays allowed while a reply streams in; sending waits until it finishes.
  const busy = isLoading || isStreaming;
  // The text in the input box. Kept here so a spoken question can be combined with a typed one.
  const [draft, setDraft] = useState('');
  const draftRef = useRef(draft);
  draftRef.current = draft;

  // Spoken replies. The ref lets a reply that finishes later read the current setting.
  const [voiceReplies, setVoiceRepliesState] = useState(false);
  const voiceRepliesRef = useRef(false);
  const setVoiceReplies = (on) => {
    voiceRepliesRef.current = on;
    setVoiceRepliesState(on);
  };
  const openRef = useRef(isOpen);
  openRef.current = isOpen;
  // Whatever had focus when the chat opened (a link, the command palette's input, the button).
  const openerRef = useRef(null);
  const restoreFocus = useRef(false);
  const rememberOpener = () => {
    if (openRef.current) return;
    const el = document.activeElement;
    openerRef.current = el && el !== document.body ? el : null;
  };

  const voice = useVoice({
    // Talking to AniBot implies you want to hear it back. Words typed before tapping the mic
    // go in front of the spoken ones.
    onFinalTranscript: (text) => {
      const question = [draftRef.current.trim(), text].filter(Boolean).join(' ');
      setShowSuggestions(false);
      if (isBusy()) {
        // A reply is still coming in. Keep the question in the box instead of dropping it.
        setDraft(question);
        return;
      }
      setDraft('');
      setVoiceReplies(true);
      ask(question);
    },
    // Recognition failed partway: let the visitor check the words and send them.
    onUnconfirmedTranscript: (text) => {
      setDraft([draftRef.current.trim(), text].filter(Boolean).join(' '));
    },
  });
  const voiceRef = useRef(voice);
  voiceRef.current = voice;

  // Sends a question and, when spoken replies are on, reads that question's own answer aloud
  // (never an error message, never the "from my notes" footnote, and never once the chat is hidden
  // or while the mic is listening).
  const ask = useCallback(
    async (question) => {
      const reply = await sendMessage(question);
      if (!reply || reply.isError || !voiceRepliesRef.current || !openRef.current) return;
      if (voiceRef.current.isListening()) return;
      voiceRef.current.speak(reply.content);
    },
    [sendMessage],
  );

  // Other parts of the page (the command palette, links to /#anibot) can open the chat,
  // optionally with a question to ask right away. See src/data/anibotEvents.js.
  useEffect(() => {
    const openWith = (question) => {
      rememberOpener();
      setIsOpen(true);
      if (!question) return;
      setShowSuggestions(false);
      // A reply is still coming in: leave the question in the box rather than lose it.
      if (isBusy()) setDraft(question);
      else ask(question);
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
  }, [ask, isBusy]);

  // Hiding the chat in any way (close, minimize, a link, the contact button) turns the mic off
  // without sending what it heard, and stops any reply being read aloud. Only after it was open:
  // on mount there is nothing of the chat's to stop (and the hero's voice call may be speaking).
  const wasOpen = useRef(false);
  useEffect(() => {
    if (isOpen) {
      wasOpen.current = true;
      return;
    }
    if (!wasOpen.current) return;
    voiceRef.current.cancelListening();
    voiceRef.current.stopSpeaking();
  }, [isOpen]);
  const windowRef = useRef(null);
  const fabRef = useRef(null);

  // Move focus into the dialog when it opens so screen readers announce it. When it closes, give
  // focus back to whatever opened it, or to the AniBot button.
  useEffect(() => {
    if (isOpen) {
      windowRef.current?.focus();
      return;
    }
    if (!restoreFocus.current) return;
    restoreFocus.current = false;
    const opener = openerRef.current;
    openerRef.current = null;
    const target = opener && opener.isConnected && opener !== document.body ? opener : fabRef.current;
    target?.focus?.({ preventScroll: true });
  }, [isOpen]);

  // While the chat is open, Tab stays inside it and Escape closes it from anywhere.
  useEffect(() => {
    if (!isOpen) return undefined;
    const onKey = (e) => {
      const dialog = windowRef.current;
      if (!dialog) return;
      if (e.key === 'Escape' && !e.defaultPrevented) {
        e.preventDefault();
        hideChatRef.current();
        return;
      }
      if (e.key !== 'Tab') return;
      const items = [...dialog.querySelectorAll('a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')].filter(
        (el) => el.getClientRects().length > 0,
      );
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      const inside = dialog.contains(document.activeElement);
      if (!inside) {
        e.preventDefault();
        (e.shiftKey ? last : first).focus();
      } else if (e.shiftKey && (document.activeElement === first || document.activeElement === dialog)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [isOpen]);

  const handleOpen = () => {
    rememberOpener();
    setIsOpen(true);
  };

  // Every way of hiding the chat goes through here, so the mic and speech stop at once.
  // `refocus` is false when the chat closes to go somewhere else on the page (a link, Contact).
  const hideChat = ({ refocus = true } = {}) => {
    if (!openRef.current) return;
    openRef.current = false;
    restoreFocus.current = refocus;
    voice.cancelListening();
    voice.stopSpeaking();
    setIsOpen(false);
  };
  const hideChatRef = useRef(hideChat);
  hideChatRef.current = hideChat;

  const handleClose = () => hideChat();

  const handleSend = (message) => {
    setDraft('');
    ask(message);
    setShowSuggestions(false);
  };

  const handleSuggestedQuestion = (question) => {
    ask(question);
    setShowSuggestions(false);
  };

  const handleContact = () => {
    hideChat({ refocus: false });
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
    hideChat({ refocus: false });
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
      {!isOpen && <FloatingChatButton onClick={handleOpen} buttonRef={fabRef} />}

      {/* Chat window: a panel in the corner on wide screens, a bottom sheet on phones. */}
      {isOpen && (
        <>
          <div className="chat-backdrop fixed inset-0 z-40 md:hidden" onClick={handleClose} aria-hidden="true" />
          <div
            ref={windowRef}
            role="dialog"
            aria-modal="true"
            aria-label="Chat with AniBot"
            tabIndex={-1}
            onClick={handleLinkClick}
            className="chat-window fixed z-50 flex flex-col font-generalsans focus:outline-none"
          >
            <span className="chat-grabber md:hidden" aria-hidden="true" />
            <ChatHeader
              onClose={handleClose}
              mode={mode}
              canSpeak={voice.canSpeak}
              voiceReplies={voiceReplies}
              onToggleVoice={() => {
                if (voiceReplies) voice.stopSpeaking();
                else voice.unlock(); // inside the tap, so iOS Safari allows the later replies
                setVoiceReplies(!voiceReplies);
              }}
            />

            <ChatMessages messages={messages} isLoading={isLoading}>
              {showSuggestions && messages.length <= 1 && !busy && (
                <SuggestedQuestions onQuestionClick={handleSuggestedQuestion} disabled={busy || voice.listening} />
              )}
            </ChatMessages>

            {hasAssistantReply && !busy && (
              <FollowUps onQuestionClick={handleSuggestedQuestion} onContact={handleContact} disabled={busy || voice.listening} />
            )}

            <ChatInput value={draft} onChange={setDraft} onSend={handleSend} disabled={isLoading} busy={isStreaming} voice={voice} />
          </div>
        </>
      )}
    </>
  );
};

export default AiChatbot;

