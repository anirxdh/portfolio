// Starter questions. Each one also has a direct answer in the offline notes (src/data/anibotLocal.js),
// so they work even when the live AI is down.
const QUESTIONS = [
  'What is Anirudh building at Rivo?',
  'Which hackathons has he won?',
  'What is his patent about?',
  'Tell me about his voice agent work',
  'What has he written about?',
];

const SuggestedQuestions = ({ onQuestionClick, disabled }) => {
  return (
    <div className="px-4 py-3 border-t border-black-300">
      <p className="text-xs text-gray-400 mb-2">💡 Suggested questions:</p>
      <div className="flex flex-wrap gap-2">
        {QUESTIONS.map((question) => (
          <button
            key={question}
            onClick={() => onQuestionClick(question)}
            disabled={disabled}
            className="text-xs px-3 py-1.5 bg-black-300 hover:bg-black-500 text-gray-300 rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-blue-400 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {question}
          </button>
        ))}
      </div>
    </div>
  );
};

export default SuggestedQuestions;
