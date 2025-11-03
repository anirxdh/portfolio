import { useState, useEffect } from 'react';
import { useGSAP } from '@gsap/react';
import gsap from 'gsap';
import useAiChat from '../../hooks/useAiChat';
import FloatingChatButton from './FloatingChatButton';
import ChatHeader from './ChatHeader';
import ChatMessages from './ChatMessages';
import ChatInput from './ChatInput';
import SuggestedQuestions from './SuggestedQuestions';

const AiChatbot = () => {
  const [isOpen, setIsOpen] = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(true);
  const { messages, isLoading, sendMessage } = useAiChat();

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
        <div className="chat-window fixed bottom-6 right-6 w-[400px] max-w-[calc(100vw-3rem)] h-[600px] max-h-[calc(100vh-3rem)] bg-black-200 border border-black-300 rounded-lg shadow-2xl flex flex-col z-50 backdrop-blur-sm">
          <ChatHeader onClose={handleClose} onMinimize={handleMinimize} />
          
          <ChatMessages messages={messages} isLoading={isLoading} />
          
          {showSuggestions && messages.length <= 1 && !isLoading && (
            <SuggestedQuestions 
              onQuestionClick={handleSuggestedQuestion} 
              disabled={isLoading}
            />
          )}
          
          <ChatInput onSend={handleSend} disabled={isLoading} />
        </div>
      )}

      {/* Mobile overlay backdrop */}
      {isOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-40 md:hidden"
          onClick={handleClose}
        />
      )}

      {/* Mobile full-screen chat */}
      <style jsx>{`
        @media (max-width: 768px) {
          .chat-window {
            width: 100vw !important;
            height: 100vh !important;
            max-width: 100vw !important;
            max-height: 100vh !important;
            bottom: 0 !important;
            right: 0 !important;
            border-radius: 0 !important;
          }
        }
      `}</style>
    </>
  );
};

export default AiChatbot;

