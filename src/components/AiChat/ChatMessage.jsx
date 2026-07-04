import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

// Markdown element styling so AniBot's replies render like a polished chat message.
const markdownComponents = {
  p: ({ children }) => <p className="mb-2 last:mb-0 leading-relaxed">{children}</p>,
  ul: ({ children }) => <ul className="list-disc pl-4 space-y-1 mb-2 last:mb-0">{children}</ul>,
  ol: ({ children }) => <ol className="list-decimal pl-4 space-y-1 mb-2 last:mb-0">{children}</ol>,
  li: ({ children }) => <li className="leading-relaxed">{children}</li>,
  strong: ({ children }) => <strong className="font-semibold text-white">{children}</strong>,
  em: ({ children }) => <em className="italic">{children}</em>,
  a: ({ children, href }) => (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="text-blue-400 underline underline-offset-2 hover:text-blue-300"
    >
      {children}
    </a>
  ),
  code: ({ children }) => (
    <code className="bg-black-300 px-1 py-0.5 rounded text-[0.8em]">{children}</code>
  ),
  h1: ({ children }) => <p className="font-semibold text-white mb-2">{children}</p>,
  h2: ({ children }) => <p className="font-semibold text-white mb-2">{children}</p>,
  h3: ({ children }) => <p className="font-semibold text-white mb-2">{children}</p>,
};

const ChatMessage = ({ message }) => {
  const isUser = message.role === 'user';
  const isError = message.isError;

  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'} mb-4`}>
      <div className={`flex items-start gap-2 max-w-[80%] ${isUser ? 'flex-row-reverse' : 'flex-row'}`}>
        {/* Avatar */}
        <div
          className={`flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center ${
            isUser ? 'bg-black-500' : 'bg-gradient-to-r from-blue-500 to-purple-500'
          }`}
        >
          {isUser ? (
            <span className="text-white text-xs">👤</span>
          ) : (
            <span className="text-white text-[11px] font-bold tracking-tight">AV</span>
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
          {/* Message content */}
          {isUser ? (
            <div className="text-sm whitespace-pre-wrap break-words">{message.content}</div>
          ) : (
            <div className="text-sm break-words">
              <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
                {message.content}
              </ReactMarkdown>
            </div>
          )}

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
