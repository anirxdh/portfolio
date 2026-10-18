// `disabled` locks the whole input (while AniBot is thinking); `busy` only holds the send button
// (while a reply is still streaming in), so a visitor can type the next question meanwhile.
// The mic waits for the reply to finish, so a spoken question is never dropped or talked over.
// `value`/`onChange` hold the typed draft; while listening, the box shows that draft plus the
// words heard so far, read-only, and Send (or Enter) finishes listening and sends both.
const ChatInput = ({ value, onChange, onSend, disabled, busy = false, voice }) => {
  const listening = !!voice?.listening;
  const heard = listening ? [value.trim(), voice.interim].filter(Boolean).join(' ') : '';

  const handleSubmit = (e) => {
    e.preventDefault();
    if (listening) {
      // Nothing spoken yet: stop the mic and send the typed draft as-is.
      if (!voice.interim) {
        voice.cancelListening();
        if (value.trim() && !disabled && !busy) onSend(value.trim());
        return;
      }
      voice.stopListening();
      return;
    }
    if (value.trim() && !disabled && !busy) onSend(value.trim());
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  };

  const sendDisabled = listening ? !heard : disabled || busy || !value.trim();

  return (
    <form onSubmit={handleSubmit} className="p-4 border-t border-black-300 bg-black-200">
      <div className="flex gap-2">
        <input
          type="text"
          value={listening ? heard : value}
          onChange={(e) => {
            if (listening) return;
            if (voice?.error) voice.clearError();
            onChange(e.target.value);
          }}
          readOnly={listening}
          onKeyDown={handleKeyDown}
          placeholder={listening ? 'Listening… speak now' : 'Type or tap the mic…'}
          aria-label="Type your message"
          disabled={disabled}
          className="flex-1 bg-black-300 text-white px-4 py-2 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 placeholder-gray-400 disabled:opacity-50 disabled:cursor-not-allowed"
        />
        {voice?.canListen && (
          <button
            type="button"
            onClick={listening ? voice.stopListening : voice.startListening}
            disabled={(disabled || busy) && !listening}
            aria-label={listening ? 'Stop listening' : 'Talk to AniBot'}
            aria-pressed={listening}
            className={`px-3 py-2 rounded-lg flex items-center justify-center min-w-[44px] transition-all disabled:opacity-50 disabled:cursor-not-allowed ${
              listening ? 'bg-red-500/90 text-white animate-pulse' : 'bg-black-300 text-gray-300 hover:text-white hover:bg-black-500'
            }`}
          >
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-5 h-5" aria-hidden="true" focusable="false">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 18.75a6 6 0 0 0 6-6v-1.5m-6 7.5a6 6 0 0 1-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5M12 15.75a3 3 0 0 1-3-3V4.5a3 3 0 1 1 6 0v8.25a3 3 0 0 1-3 3Z" />
            </svg>
          </button>
        )}
        <button
          type="submit"
          disabled={sendDisabled}
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
      <p role="status" aria-live="polite" className={voice?.error ? 'mt-2 text-xs text-amber-300' : 'sr-only'}>
        {voice?.error || ''}
      </p>
    </form>
  );
};

export default ChatInput;
