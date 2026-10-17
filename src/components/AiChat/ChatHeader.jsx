const ChatHeader = ({ onClose, onMinimize, voiceReplies, onToggleVoice, canSpeak }) => {
  return (
    <div className="flex items-center justify-between px-4 py-3 bg-black-300 border-b border-black-300 rounded-t-lg">
      <div className="flex items-center gap-2">
        <div className="w-3 h-3 bg-green-500 rounded-full animate-pulse"></div>
        <div>
          <h3 className="text-white font-semibold text-sm">Chat with AniBot</h3>
          <p className="text-xs text-gray-400">AI Assistant • Online</p>
        </div>
      </div>

      <div className="flex items-center gap-2">
        {canSpeak && (
          <button
            onClick={onToggleVoice}
            className={`w-8 h-8 flex items-center justify-center rounded transition-colors hover:bg-black-500 ${voiceReplies ? 'text-green-400' : 'text-gray-400 hover:text-white'}`}
            aria-label={voiceReplies ? 'Turn off spoken replies' : 'Read replies aloud'}
            aria-pressed={voiceReplies}
            title={voiceReplies ? 'Spoken replies on' : 'Spoken replies off'}
          >
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-5 h-5" aria-hidden="true" focusable="false">
              {voiceReplies ? (
                <path strokeLinecap="round" strokeLinejoin="round" d="M19.114 5.636a9 9 0 0 1 0 12.728M16.463 8.288a5.25 5.25 0 0 1 0 7.424M6.75 8.25l4.72-4.72a.75.75 0 0 1 1.28.53v15.88a.75.75 0 0 1-1.28.53l-4.72-4.72H4.51c-.88 0-1.704-.507-1.938-1.354A9.009 9.009 0 0 1 2.25 12c0-.83.112-1.633.322-2.396C2.806 8.756 3.63 8.25 4.51 8.25H6.75Z" />
              ) : (
                <path strokeLinecap="round" strokeLinejoin="round" d="M17.25 9.75 19.5 12m0 0 2.25 2.25M19.5 12l2.25-2.25M19.5 12l-2.25 2.25m-10.5-6 4.72-4.72a.75.75 0 0 1 1.28.53v15.88a.75.75 0 0 1-1.28.53l-4.72-4.72H4.51c-.88 0-1.704-.507-1.938-1.354A9.009 9.009 0 0 1 2.25 12c0-.83.112-1.633.322-2.396C2.806 8.756 3.63 8.25 4.51 8.25H6.75Z" />
              )}
            </svg>
          </button>
        )}
        <button
          onClick={onMinimize}
          className="w-8 h-8 flex items-center justify-center text-gray-400 hover:text-white hover:bg-black-500 rounded transition-colors"
          aria-label="Minimize chat"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={2}
            stroke="currentColor"
            className="w-5 h-5"
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 12h-15" />
          </svg>
        </button>
        <button
          onClick={onClose}
          className="w-8 h-8 flex items-center justify-center text-gray-400 hover:text-white hover:bg-black-500 rounded transition-colors"
          aria-label="Close chat"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={2}
            stroke="currentColor"
            className="w-5 h-5"
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
    </div>
  );
};

export default ChatHeader;

