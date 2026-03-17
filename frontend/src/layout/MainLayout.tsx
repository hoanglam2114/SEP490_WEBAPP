import React from 'react';
import { Toaster } from 'react-hot-toast';
import { Bot, ChevronLeft } from 'lucide-react';
import { useAppStore } from '../hooks/useAppStore';
import { useNavigate, useLocation } from 'react-router-dom';

interface MainLayoutProps {
  children: React.ReactNode;
}

export function MainLayout({ children }: MainLayoutProps) {
  const { uploadedFile, resetOptions } = useAppStore();
  const navigate = useNavigate();
  const location = useLocation();

  const isHomePage = location.pathname === '/';

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100">
      <Toaster position="top-right" />

      {/* Header */}
      <header className="bg-white border-b border-gray-200 shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-3">
              {!isHomePage && (
                <button
                  onClick={() => navigate('/')}
                  className="p-1 mr-2 text-gray-800 hover:text-black hover:bg-gray-100 rounded-lg transition-colors flex items-center justify-center"
                  aria-label="Go back"
                >
                  <ChevronLeft className="w-8 h-8" strokeWidth={3} />
                </button>
              )}
              <Bot className="w-8 h-8 text-primary-600" />
              <div>
                <h1 className="text-2xl font-bold text-gray-900">
                  Chatbot Data Converter
                </h1>
                <p className="text-sm text-gray-500 mt-1">
                  Convert MongoDB chat data to fine-tuning formats
                </p>
              </div>
            </div>
            {uploadedFile && (
              <button
                onClick={resetOptions}
                className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
              >
                Reset & Upload New
              </button>
            )}
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {children}
      </main>

      {/* Footer */}
      <footer className="bg-white border-t border-gray-200 mt-12">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          <p className="text-center text-sm text-gray-500">
            Built with React, TypeScript, and Node.js
          </p>
        </div>
      </footer>
    </div>
  );
}
