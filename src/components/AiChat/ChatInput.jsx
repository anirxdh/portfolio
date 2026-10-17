import { useState } from 'react';

// `disabled` locks the whole input (while AniBot is thinking); `busy` only holds the send button
// (while a reply is still streaming in), so a visitor can type the next question meanwhile.
const ChatInput = ({ onSend, disabled, busy = false, voice }) => {
  const [input, setInput] = useState('');

  const handleSubmit = (e) => {
    e.preventDefault();
    if (input.trim() && !disabled && !busy) {
      onSend(input.trim());
      setInput('');
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="p-4 border-t border-black-300 bg-black-200">
      <div className="flex gap-2">
        <input
          type="text"
          value={voice?.listening ? voice.interim || '' : input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={voice?.listening ? 'Listening… speak now' : 'Type or tap the mic…'}
          aria-label="Type your message"
          disabled={disabled}
          className="flex-1 bg-black-300 text-white px-4 py-2 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 placeholder-gray-400 disabled:opacity-50 disabled:cursor-not-allowed"
        />
        {voice?.canListen && (
          <button
            type="button"
            onClick={voice.listening ? voice.stopListening : voice.startListening}
            disabled={disabled && !voice.listening}
            aria-label={voice.listening ? 'Stop listening' : 'Talk to AniBot'}
            aria-pressed={voice.listening}
            className={`px-3 py-2 rounded-lg flex items-center justify-center min-w-[44px] transition-all disabled:opacity-50 disabled:cursor-not-allowed ${
              voice.listening ? 'bg-red-500/90 text-white animate-pulse' : 'bg-black-300 text-gray-300 hover:text-white hover:bg-black-500'
            }`}
          >
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-5 h-5" aria-hidden="true" focusable="false">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 18.75a6 6 0 0 0 6-6v-1.5m-6 7.5a6 6 0 0 1-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5M12 15.75a3 3 0 0 1-3-3V4.5a3 3 0 1 1 6 0v8.25a3 3 0 0 1-3 3Z" />
            </svg>
          </button>
        )}
        <button
          type="submit"
          disabled={disabled || busy || !input.trim()}
          aria-label="Send message"
          className="px-4 py-2 bg-gradient-to-r from-blue-500 to-purple-500 text-white rounded-lg hover:from-blue-600 hover:to-purple-600 disabled:opacity-50 disabled:cursor-not-allowed transition-all flex items-center justify-center min-w-[44px]"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={2}
            stroke="currentColor"
            className="w-5 h-5"
            aria-hidden="true"
            focusable="false"
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12h15m0 0l-6.75-6.75M19.5 12l-6.75 6.75" />
          </svg>
        </button>
      </div>
    </form>
  );
};

export default ChatInput;

