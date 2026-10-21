const FOLLOWUPS = [
  'What AI agents has he built?',
  'Tell me about his patents & publications',
  'How can I work with him?',
];

const FollowUps = ({ onQuestionClick, onContact, disabled }) => {
  return (
    <div className="px-4 sm:px-5 py-3 border-t border-black-300 space-y-2.5">
      <p className="text-[12px] font-medium uppercase tracking-[0.08em] text-white-600/80">Keep exploring</p>
      <div className="flex gap-2 overflow-x-auto chat-scroll-x -mx-4 px-4 sm:-mx-5 sm:px-5 pb-0.5">
        {FOLLOWUPS.map((q) => (
          <button key={q} type="button" onClick={() => onQuestionClick(q)} disabled={disabled} className="chat-chip shrink-0">
            {q}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap gap-2">
        <a href="mailto:anirudhvasudevan11@gmail.com" className="chat-chip chat-chip-strong">
          Email Anirudh
        </a>
        <button type="button" onClick={onContact} className="chat-chip">
          Go to the contact form <span aria-hidden="true">↓</span>
        </button>
      </div>
    </div>
  );
};

export default FollowUps;
