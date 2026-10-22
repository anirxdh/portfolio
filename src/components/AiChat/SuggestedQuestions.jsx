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
    <div className="pt-1">
      <p className="text-[12px] font-medium uppercase tracking-[0.08em] text-white-600/80 mb-2.5">Try asking</p>
      <div className="flex flex-wrap gap-2">
        {QUESTIONS.map((question) => (
          <button key={question} type="button" onClick={() => onQuestionClick(question)} disabled={disabled} className="chat-chip">
            {question}
          </button>
        ))}
      </div>
    </div>
  );
};

export default SuggestedQuestions;
