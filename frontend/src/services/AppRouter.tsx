import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Route, BrowserRouter as Router, Routes } from 'react-router-dom';

import { AutoTrainScreen } from '../pages/AutoTrainScreen';
import ChatPage from "../pages/ChatPage";
import { ConversionPage } from '../pages/ConversionPage';
import { HomePage } from '../pages/HomePage';
import { MainLayout } from '../layout/MainLayout';
import { TrainingHistoryScreen } from '../pages/TrainingHistoryScreen';
import { ModelListScreen } from '../pages/ModelListScreen';
import { EvaluationResultsScreen } from '../pages/EvaluationResultsScreen';
import { RunEvaluationScreen } from '../pages/RunEvaluationScreen';
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
          <Route path="/models" element={<ModelListScreen />} />
          <Route path="/eval/run" element={<RunEvaluationScreen />} />
          {/* /eval/:evalId phải đứng SAU /eval/run để không bị shadow */}
          <Route path="/eval/:evalId" element={<EvaluationResultsScreen />} />
        </Routes>
      </Router>
    </QueryClientProvider>
  );
}
