const TypingIndicator = () => {
  return (
    <div className="flex items-center gap-2.5" role="status">
      <span className="anibot-mark anibot-mark-sm" aria-hidden="true" />
      <div className="flex items-center gap-1.5 px-4 py-3.5 bg-black-300 rounded-2xl rounded-tl-md">
        <span className="sr-only">AniBot is typing</span>
        <span className="chat-dot" aria-hidden="true" style={{ animationDelay: '0ms' }}></span>
        <span className="chat-dot" aria-hidden="true" style={{ animationDelay: '160ms' }}></span>
        <span className="chat-dot" aria-hidden="true" style={{ animationDelay: '320ms' }}></span>
      </div>
    </div>
  );
};

export default TypingIndicator;
