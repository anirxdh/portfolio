const SuggestedQuestions = ({ onQuestionClick, disabled }) => {
  const questions = [
    "What is Anirudh building at Rivo?",
    "Tell me about the YC Hackathon project (LARK)",
    "What AI agent & RAG projects has he built?",
    "What's his tech stack?",
    "How can I get in touch?",
  ];

  return (
    <div className="px-4 py-3 border-t border-black-300">
      <p className="text-xs text-gray-400 mb-2">💡 Suggested questions:</p>
      <div className="flex flex-wrap gap-2">
        {questions.map((question) => (
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

