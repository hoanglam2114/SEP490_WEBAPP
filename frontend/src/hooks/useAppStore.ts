import { create } from 'zustand';
import type { FileUploadResult, ConversionOptions } from '../types';

interface AppState {
  uploadedFile: FileUploadResult | null;
  conversionOptions: ConversionOptions;
  projectName: string;
  setUploadedFile: (file: FileUploadResult | null) => void;
  updateConversionOptions: (options: Partial<ConversionOptions>) => void;
  setProjectName: (name: string) => void;
  resetOptions: () => void;
}

const defaultOptions: ConversionOptions = {
  format: 'openai',
  includeSystemPrompt: false,
  systemPrompt: '',
  removeThinkTags: true,
};

export const useAppStore = create<AppState>((set) => ({
  uploadedFile: null,
  conversionOptions: defaultOptions,
  projectName: '',

  setUploadedFile: (file) =>
    set((state) => {
      let nextFormat = state.conversionOptions.format;
      if (file?.fileType === 'lesson') {
        nextFormat = 'alpaca';
      } else if (file?.fileType === 'openai_messages') {
        nextFormat = 'openai';
      }

      return {
        uploadedFile: file,
        conversionOptions: { ...state.conversionOptions, format: nextFormat },
      };
    }),

  updateConversionOptions: (options) =>
    set((state) => ({
      conversionOptions: { ...state.conversionOptions, ...options },
    })),

  setProjectName: (name) =>
    set({ projectName: name }),

  resetOptions: () =>
    set({ conversionOptions: defaultOptions, uploadedFile: null, projectName: '' }),
}));