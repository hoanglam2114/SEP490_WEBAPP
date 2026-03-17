import React from 'react';
import { useNavigate } from 'react-router-dom';

const options = [
  {
    title: 'Chatbot Data Converter',
    description: 'Convert chatbot data to Instruction/Input/Output format for fine-tuning',
    path: '/chatbotconverter',
    icon: '🔄',
  },
  {
    title: 'AutoTrain',
    description: 'Train LLM models with custom datasets using Mock GPU Server',
    path: '/autotrain',
    icon: '🚀',
  },
  {
    title: 'AI Chatbot ',
    path: '/chat',
    icon: '🤖',
  },
];

export const HomePage: React.FC = () => {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center p-8">
      <h1 className="text-3xl font-bold mb-2 text-gray-900">Chatbot Training Toolkit</h1>
      <p className="text-gray-500 mb-10">Select a tool to get started</p>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-8 max-w-3xl w-full">
        {options.map(opt => (
          <button
            key={opt.path}
            onClick={() => navigate(opt.path)}
            className="flex flex-col items-center bg-white border border-gray-200 rounded-2xl shadow hover:shadow-lg hover:border-blue-400 transition-all p-10 cursor-pointer group"
          >
            <span className="text-5xl mb-4 group-hover:scale-110 transition-transform">{opt.icon}</span>
            <span className="text-xl font-semibold text-gray-900 mb-2">{opt.title}</span>
            <span className="text-sm text-gray-500 text-center">{opt.description}</span>
          </button>
        ))}
      </div>
    </div>
  );
};
