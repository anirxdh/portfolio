const SuggestedQuestions = ({ onQuestionClick, disabled }) => {
  const questions = [
    "What projects has Anirudh worked on?",
    "What are his technical skills?",
    "Is he available for opportunities?",
    "Tell me about his experience at Nonlinear",
  ];

  return (
    <div className="px-4 py-3 border-t border-black-300">
      <p className="text-xs text-gray-400 mb-2">💡 Suggested questions:</p>
      <div className="flex flex-wrap gap-2">
        {questions.map((question, index) => (
          <button
            key={index}
            onClick={() => onQuestionClick(question)}
            disabled={disabled}
            className="text-xs px-3 py-1.5 bg-black-300 hover:bg-black-500 text-gray-300 rounded-full transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {question}
          </button>
        ))}
      </div>
    </div>
  );
};

export default SuggestedQuestions;

