const ChatHeader = ({ onClose, onMinimize }) => {
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

