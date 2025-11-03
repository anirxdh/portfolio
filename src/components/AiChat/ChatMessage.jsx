const ChatMessage = ({ message }) => {
  const isUser = message.role === 'user';
  const isError = message.isError;

  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'} mb-4`}>
      <div className={`flex items-start gap-2 max-w-[80%] ${isUser ? 'flex-row-reverse' : 'flex-row'}`}>
        {/* Avatar */}
        <div
          className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center overflow-hidden ${
            isUser ? 'bg-black-500' : 'bg-gradient-to-r from-blue-500 to-purple-500'
          }`}
        >
          {isUser ? (
            <span className="text-white text-sm font-semibold">👤</span>
          ) : (
            <img 
              src="/assets/anirudh-avatar.png" 
              alt="AniBot"
              className="w-full h-full object-cover"
            />
          )}
        </div>

        {/* Message bubble */}
        <div
          className={`px-4 py-3 rounded-lg ${
            isUser
              ? 'bg-black-500 text-white'
              : isError
              ? 'bg-red-900/30 border border-red-500/50 text-red-200'
              : 'bg-black-200 text-gray-100'
          }`}
        >
          {/* Message content - preserve line breaks */}
          <div className="text-sm whitespace-pre-wrap break-words">{message.content}</div>

          {/* Timestamp */}
          <div className={`text-xs mt-1 ${isUser ? 'text-gray-400' : 'text-gray-500'}`}>
            {new Date(message.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </div>
        </div>
      </div>
    </div>
  );
};

export default ChatMessage;

