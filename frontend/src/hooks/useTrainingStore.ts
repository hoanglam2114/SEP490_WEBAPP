import { create } from 'zustand';
import { TrainingStatus, JobConfig } from '../pages/AutoTrainScreen';

interface TrainingStore {
  activeJobs: Record<string, TrainingStatus>;
  lossHistories: Record<string, { progress: number; loss: number }[]>;
  jobConfigs: Record<string, JobConfig>;
  trainingStartTimes: Record<string, Date>;
  trainingStartProgress: Record<string, number>;
  eventSources: Record<string, EventSource>;
  
  // Actions
  addJob: (jobId: string, config: JobConfig) => void;
  updateJobStatus: (jobId: string, status: TrainingStatus) => void;
  updateLossHistory: (jobId: string, progress: number, loss: number) => void;
  removeJob: (jobId: string) => void;
  setJobConfig: (jobId: string, config: JobConfig) => void;
  setEventSource: (jobId: string, es: EventSource) => void;
  closeEventSource: (jobId: string) => void;
  clearStore: () => void;
}

export const useTrainingStore = create<TrainingStore>((set, get) => ({
  activeJobs: {},
  lossHistories: {},
  jobConfigs: {},
  trainingStartTimes: {},
  trainingStartProgress: {},
  eventSources: {},

  addJob: (jobId, config) => set((state) => ({
    activeJobs: { ...state.activeJobs, [jobId]: { status: 'QUEUED', progress: 0, logs: [] } },
    jobConfigs: { ...state.jobConfigs, [jobId]: config },
    trainingStartTimes: { ...state.trainingStartTimes, [jobId]: new Date() },
    trainingStartProgress: { ...state.trainingStartProgress, [jobId]: 0 }
  })),

  updateJobStatus: (jobId, status) => set((state) => {
    const startProgress = state.trainingStartProgress[jobId];
    const newStartProgress = (startProgress === undefined) ? (status.progress || 0) : startProgress;

    return {
      activeJobs: { ...state.activeJobs, [jobId]: status },
      trainingStartProgress: { ...state.trainingStartProgress, [jobId]: newStartProgress }
    };
  }),

  updateLossHistory: (jobId, progress, loss) => set((state) => {
    const history = state.lossHistories[jobId] || [];
    const lastEntry = history[history.length - 1];
    
    if (!lastEntry || lastEntry.loss !== loss) {
      return {
        lossHistories: {
          ...state.lossHistories,
          [jobId]: [...history, { progress, loss }]
        }
      };
    }
    return state;
  }),

  removeJob: (jobId) => set((state) => {
    const newActiveJobs = { ...state.activeJobs };
    delete newActiveJobs[jobId];
    return { activeJobs: newActiveJobs };
  }),

  setJobConfig: (jobId, config) => set((state) => ({
    jobConfigs: { ...state.jobConfigs, [jobId]: config }
  })),

  setEventSource: (jobId, es) => set((state) => ({
    eventSources: { ...state.eventSources, [jobId]: es }
  })),

  closeEventSource: (jobId) => {
    const es = get().eventSources[jobId];
    if (es) {
      es.close();
      set((state) => {
        const newES = { ...state.eventSources };
        delete newES[jobId];
        return { eventSources: newES };
      });
    }
  },

  clearStore: () => {
    const { eventSources } = get();
    Object.values(eventSources).forEach(es => es.close());
    set({
      activeJobs: {},
      lossHistories: {},
      jobConfigs: {},
      trainingStartTimes: {},
      trainingStartProgress: {},
      eventSources: {}
    });
  }
}));
