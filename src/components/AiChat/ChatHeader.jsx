// The chat window's header: AniBot's mark, its status, spoken replies on or off, and close.
const ChatHeader = ({ onClose, voiceReplies, onToggleVoice, canSpeak, mode = 'live' }) => {
  const notes = mode === 'notes';
  return (
    <div className="flex items-center justify-between gap-3 px-4 sm:px-5 pt-4 pb-3 border-b border-black-300">
      <div className="flex items-center gap-3 min-w-0">
        <span className="anibot-mark" aria-hidden="true">
          <span className={`anibot-mark-dot ${notes ? 'is-notes' : ''}`} />
        </span>
        <div className="min-w-0">
          <h2 className="text-white-800 font-semibold text-[15px] leading-tight tracking-[-0.01em]">AniBot</h2>
          <p className="text-[12.5px] leading-snug text-white-600 truncate" aria-live="polite">
            {notes ? 'Answering from notes' : "Ask about Anirudh's work"}
          </p>
        </div>
      </div>

      <div className="flex items-center gap-1">
        {canSpeak && (
          <button
            type="button"
            onClick={onToggleVoice}
            className={`chat-icon-btn ${voiceReplies ? 'text-green-400' : ''}`}
            aria-label={voiceReplies ? 'Turn off spoken replies' : 'Read replies aloud'}
            aria-pressed={voiceReplies}
            title={voiceReplies ? 'Spoken replies on' : 'Spoken replies off'}
          >
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor" className="w-[18px] h-[18px]" aria-hidden="true" focusable="false">
              {voiceReplies ? (
                <path strokeLinecap="round" strokeLinejoin="round" d="M19.114 5.636a9 9 0 0 1 0 12.728M16.463 8.288a5.25 5.25 0 0 1 0 7.424M6.75 8.25l4.72-4.72a.75.75 0 0 1 1.28.53v15.88a.75.75 0 0 1-1.28.53l-4.72-4.72H4.51c-.88 0-1.704-.507-1.938-1.354A9.009 9.009 0 0 1 2.25 12c0-.83.112-1.633.322-2.396C2.806 8.756 3.63 8.25 4.51 8.25H6.75Z" />
              ) : (
                <path strokeLinecap="round" strokeLinejoin="round" d="M17.25 9.75 19.5 12m0 0 2.25 2.25M19.5 12l2.25-2.25M19.5 12l-2.25 2.25m-10.5-6 4.72-4.72a.75.75 0 0 1 1.28.53v15.88a.75.75 0 0 1-1.28.53l-4.72-4.72H4.51c-.88 0-1.704-.507-1.938-1.354A9.009 9.009 0 0 1 2.25 12c0-.83.112-1.633.322-2.396C2.806 8.756 3.63 8.25 4.51 8.25H6.75Z" />
              )}
            </svg>
          </button>
        )}
        <button type="button" onClick={onClose} className="chat-icon-btn" aria-label="Close chat">
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor" className="w-[18px] h-[18px]" aria-hidden="true" focusable="false">
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
    </div>
  );
};

export default ChatHeader;
