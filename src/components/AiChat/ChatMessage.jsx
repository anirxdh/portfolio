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
  // Homepage sections ("/#contact") open in place; pages and other sites open in a new tab so
  // the conversation stays put.
  a: ({ children, href = '' }) => (
    <a
      href={href}
      {...(/^\/?#/.test(href) ? {} : { target: '_blank', rel: 'noopener noreferrer' })}
      className="text-white-800 underline decoration-black-500 underline-offset-[3px] hover:text-white hover:decoration-green-400"
    >
      {children}
    </a>
  ),
  code: ({ children }) => (
    <code className="bg-black-200 px-1 py-0.5 rounded text-[0.85em]">{children}</code>
  ),
  h1: ({ children }) => <p className="font-semibold text-white mb-2">{children}</p>,
  h2: ({ children }) => <p className="font-semibold text-white mb-2">{children}</p>,
  h3: ({ children }) => <p className="font-semibold text-white mb-2">{children}</p>,
};

const ChatMessage = ({ message }) => {
  const isUser = message.role === 'user';
  const isError = message.isError;

  const time = new Date(message.timestamp).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

  if (isUser) {
    return (
      <div className="flex justify-end chat-msg">
        <div className="max-w-[85%] flex flex-col items-end">
          <div className="px-4 py-2.5 rounded-2xl rounded-tr-md bg-white-800 text-black-100 text-[14.5px] leading-relaxed whitespace-pre-wrap break-words">
            {message.content}
          </div>
          <div className="text-[11px] mt-1 mr-1 text-white-500">{time}</div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-start gap-2.5 chat-msg">
      <span className="anibot-mark anibot-mark-sm mt-0.5" aria-hidden="true" />
      <div className="max-w-[85%] min-w-0 flex flex-col">
        <div
          className={`px-4 py-3 rounded-2xl rounded-tl-md text-[14.5px] break-words ${
            isError ? 'bg-red-950/40 border border-red-500/30 text-red-100' : 'bg-black-300 text-white-800'
          }`}
        >
          <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
            {message.content}
          </ReactMarkdown>

          {/* Footnote on answers that came from the offline notes (kept out of the spoken text). */}
          {message.note && <p className="text-xs mt-2 text-white-600">{message.note}</p>}
        </div>
        <div className="text-[11px] mt-1 ml-1 text-white-500">AniBot · {time}</div>
      </div>
    </div>
  );
};

export default ChatMessage;
