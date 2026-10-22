// The always-there way into AniBot: a small dark orb in the corner, on brand with the hero's orb.
const FloatingChatButton = ({ onClick, buttonRef }) => {
  return (
    <button
      ref={buttonRef}
      type="button"
      onClick={onClick}
      className="anibot-fab group fixed bottom-5 right-5 sm:bottom-6 sm:right-6 z-50"
      aria-label="Chat with AniBot"
    >
      <span className="anibot-fab-orb" aria-hidden="true" />
      <span className="anibot-fab-dot" aria-hidden="true" />
      <span className="pointer-events-none absolute bottom-full right-0 mb-2 px-3 py-1.5 bg-black-200 border border-black-300 text-white-800 text-xs rounded-lg opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap">
        Chat with AniBot
      </span>
    </button>
  );
};

export default FloatingChatButton;
