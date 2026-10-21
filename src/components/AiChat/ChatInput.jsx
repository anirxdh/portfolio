import { Arrow } from '../Arrow.jsx';

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
    <form onSubmit={handleSubmit} className="px-3 sm:px-4 pt-3 pb-[max(12px,env(safe-area-inset-bottom))] border-t border-black-300">
      <div className={`chat-inputbar ${listening ? 'is-listening' : ''}`}>
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
          placeholder={listening ? 'Listening… speak now' : 'Ask AniBot anything'}
          aria-label="Type your message"
          disabled={disabled}
          enterKeyHint="send"
          className="flex-1 min-w-0 bg-transparent text-white-800 text-[15px] px-3.5 py-2.5 focus:outline-none placeholder:text-white-600/70 disabled:opacity-50 disabled:cursor-not-allowed"
        />
        {voice?.canListen && (
          <button
            type="button"
            onClick={listening ? voice.stopListening : voice.startListening}
            disabled={(disabled || busy) && !listening}
            aria-label={listening ? 'Stop listening' : 'Speak your question'}
            aria-pressed={listening}
            className={`chat-icon-btn shrink-0 ${listening ? 'is-recording' : ''}`}
          >
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor" className="w-[18px] h-[18px]" aria-hidden="true" focusable="false">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 18.75a6 6 0 0 0 6-6v-1.5m-6 7.5a6 6 0 0 1-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5M12 15.75a3 3 0 0 1-3-3V4.5a3 3 0 1 1 6 0v8.25a3 3 0 0 1-3 3Z" />
            </svg>
          </button>
        )}
        <button type="submit" disabled={sendDisabled} aria-label="Send message" className="chat-send shrink-0">
          <Arrow size={18} />
        </button>
      </div>
      <p role="status" aria-live="polite" className={voice?.error ? 'mt-2 px-1 text-xs text-amber-300' : 'sr-only'}>
        {voice?.error || ''}
      </p>
    </form>
  );
};

export default ChatInput;
