import React, { useEffect, useState } from 'react';
import { Toaster } from 'react-hot-toast';
import { Bot, ChevronLeft } from 'lucide-react';
import { useAppStore } from '../hooks/useAppStore';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuthStore } from '../store/authStore';

interface MainLayoutProps {
  children: React.ReactNode;
}

export function MainLayout({ children }: MainLayoutProps) {
  const { uploadedFile, resetOptions } = useAppStore();
  const navigate = useNavigate();
  const location = useLocation();
  const { user, logout } = useAuthStore();

  const [dataPrepStep, setDataPrepStep] = useState<number | null>(null);

  const isHomePage = location.pathname === '/';
  const showDataPrepNextButton = location.pathname === '/chatbotconverter' && dataPrepStep === 8;

  useEffect(() => {
    const handleDataPrepStepChange = (event: Event) => {
      const customEvent = event as CustomEvent<{ step: number | null }>;
      const step = customEvent.detail?.step;
      setDataPrepStep(typeof step === 'number' ? step : null);
    };

    window.addEventListener('data-prep-step-change', handleDataPrepStepChange as EventListener);
    return () => {
      window.removeEventListener('data-prep-step-change', handleDataPrepStepChange as EventListener);
    };
  }, []);

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
                  Data Preparation
                </h1>
                <p className="text-sm text-gray-500 mt-1">
                  Convert chat data to fine-tuning formats
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {uploadedFile && (
                <button
                  onClick={resetOptions}
                  className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
                >
                  Reset & Upload New
                </button>
              )}

              {showDataPrepNextButton && (
                <button
                  onClick={() => navigate('/autotrain')}
                  className="px-4 py-2 text-sm font-semibold text-emerald-800 bg-emerald-100 border border-emerald-300 rounded-lg hover:bg-emerald-200 transition-colors"
                >
                  AutoTrain
                </button>
              )}

              {/* Auth Status */}
              <div className="ml-4 pl-4 border-l border-gray-200 flex items-center gap-4">
                {user ? (
                  <div className="flex items-center gap-3">
                    <span className="text-sm font-medium text-gray-700">Hello, {user.name}</span>
                    <button
                      onClick={() => {
                        logout();
                        navigate('/login');
                      }}
                      className="text-sm font-medium text-red-600 hover:text-red-800"
                    >
                      Logout
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => navigate('/login')}
                    className="text-sm font-medium text-slate-700 hover:text-slate-900 bg-slate-100 px-3 py-1.5 rounded-md"
                  >
                    Sign In
                  </button>
                )}
              </div>
            </div>
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
