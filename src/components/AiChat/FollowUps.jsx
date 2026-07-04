const FOLLOWUPS = [
  'What AI agents has he built?',
  'Tell me about his patents & publications',
  'How can I work with him?',
];

const FollowUps = ({ onQuestionClick, onContact, disabled }) => {
  return (
    <div className="px-4 py-3 border-t border-black-300 space-y-2">
      <p className="text-xs text-gray-400">Keep exploring:</p>
      <div className="flex flex-wrap gap-2">
        {FOLLOWUPS.map((q) => (
          <button
            key={q}
            onClick={() => onQuestionClick(q)}
            disabled={disabled}
            className="text-xs px-3 py-1.5 bg-black-300 hover:bg-black-500 text-gray-300 rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-blue-400 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {q}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap gap-2 pt-1">
        <a
          href="mailto:anirudhvasudevan11@gmail.com"
          className="text-xs px-3 py-1.5 bg-gradient-to-r from-blue-500 to-purple-500 text-white rounded-full hover:from-blue-600 hover:to-purple-600 transition-all focus:outline-none focus:ring-2 focus:ring-blue-300"
        >
          📧 Email Anirudh
        </a>
        <button
          onClick={onContact}
          className="text-xs px-3 py-1.5 border border-black-300 text-gray-300 rounded-full hover:bg-black-300 transition-colors focus:outline-none focus:ring-2 focus:ring-blue-400"
        >
          Go to contact form ↓
        </button>
      </div>
    </div>
  );
};

export default FollowUps;
