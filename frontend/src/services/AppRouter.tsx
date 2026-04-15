import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Route, BrowserRouter as Router, Routes } from 'react-router-dom';

import { AutoTrainScreen } from '../pages/AutoTrainScreen';
import ChatPage from "../pages/ChatPage";
import { ConversionPage } from '../pages/ConversionPage';
import { HomePage } from '../pages/HomePage';
import { MainLayout } from '../layout/MainLayout';
import { TrainingHistoryScreen } from '../pages/TrainingHistoryScreen';

import { ModelEvalLeaderboardScreen } from '../pages/ModelEvalLeaderboardScreen';
import { ModelEvalResultScreen } from '../pages/ModelEvalResultScreen';
import { ModelEvalRunScreen } from '../pages/ModelEvalRunScreen';
import { ModelEvalHistoryScreen } from '../pages/ModelEvalHistoryScreen';
import { ModelEvalCompareScreen } from '../pages/ModelEvalCompareScreen';

import { EvaluationHistory } from '../pages/EvaluationHistory';


const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});

export default function AppRouter() {
  return (
    <QueryClientProvider client={queryClient}>
      <Router>
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route
            path="/chatbotconverter"
            element={
              <MainLayout>
                <ConversionPage />
              </MainLayout>
            }
          />
          <Route
            path="/autotrain"
            element={<AutoTrainScreen />}
          />
          <Route path="/training-history" element={<TrainingHistoryScreen />} />
          <Route path="/evaluation-history" element={<EvaluationHistory />} />
          <Route path="/chat" element={<ChatPage />} />

          {/* Model evaluation flow */}
          <Route path="/model-eval/leaderboard" element={<ModelEvalLeaderboardScreen />} />
          <Route path="/model-eval/run" element={<ModelEvalRunScreen />} />
          <Route path="/model-eval/history/:jobId" element={<ModelEvalHistoryScreen />} />
          <Route path="/model-eval/compare" element={<ModelEvalCompareScreen />} />
          {/* /model-eval/:evalId phải đứng SAU /model-eval/run, /history, /compare để không bị shadow */}
          <Route path="/model-eval/:evalId" element={<ModelEvalResultScreen />} />
        </Routes>
      </Router>
    </QueryClientProvider>
  );
}
