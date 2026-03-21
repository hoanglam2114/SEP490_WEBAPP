// import axios from 'axios';
import {
  ConversionOptions,
  ConversionResult,
  FileStats,
  FileUploadResult,
  PreviewData,
  EvaluationResult,
} from '../types';

import axios from 'axios';

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000/api';

const api = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  }
});

export const apiService = {
  chat: async (text_input: string, hf_hub_id: string = "") => {
    const response = await api.post("/chat", { text_input, hf_hub_id });
    return response.data;
  },

  infer: async (text_input: string, hf_model_id: string = "") => {
    // Gọi đến API backend của chúng ta, sau đó backend proxy tới Flask Python hoặc có thể gọi thẳng
    // Tạm thời gọi đến /chat (đã được sửa logic proxy) hoặc endpoint riêng /infer
    const response = await api.post("/infer", { text_input, hf_model_id });
    return response.data;
  },

  inferStream: async (text_input: string, hf_model_id: string = "", onChunk: (text: string) => void) => {
    const response = await fetch(`${API_BASE_URL}/infer/stream`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept": "text/event-stream",
      },
      body: JSON.stringify({ text_input, hf_model_id }),
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    if (!response.body) {
      throw new Error("Luồng dữ liệu rỗng");
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder("utf-8");
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      
      // Giữ lại phần tử cuối cùng trong buffer (nếu nó không kết thúc bằng newline)
      buffer = lines.pop() || "";

      for (const line of lines) {
        if (line.trim().startsWith('data:')) {
          const dataText = line.trim().substring(5).trim();

          if (dataText === '[DONE]') {
            return;
          }

          if (dataText) {
            try {
              const dataObj = JSON.parse(dataText);
              if (dataObj.error) {
                 throw new Error(dataObj.error);
              }
              if (dataObj.text) {
                onChunk(dataObj.text);
              }
            } catch (e) {
              console.warn("Lỗi parse SSE JSON:", dataText);
            }
          }
        }
      }
    }
  },

  uploadFile: async (file: File): Promise<FileUploadResult> => {
    const formData = new FormData();
    formData.append('file', file);

    const response = await api.post<FileUploadResult>('/upload', formData, {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
    });

    return response.data;
  },

  convertData: async (
    fileId: string,
    options: ConversionOptions
  ): Promise<ConversionResult> => {
    const response = await api.post<ConversionResult>('/convert', {
      fileId,
      options,
    });

    return response.data;
  },

  getStats: async (fileId: string): Promise<FileStats> => {
    const response = await api.get<FileStats>(`/stats/${fileId}`);
    return response.data;
  },

  getPreview: async (fileId: string, limit = 5): Promise<PreviewData> => {
    const response = await api.get<PreviewData>(`/preview/${fileId}`, {
      params: { limit },
    });
    return response.data;
  },

  deleteFile: async (fileId: string): Promise<void> => {
    await api.delete(`/file/${fileId}`);
  },

  evaluateData: async (
    data: any[],
    format?: string,
    sampleSize?: number
  ): Promise<EvaluationResult> => {
    const response = await api.post<EvaluationResult>('/evaluate', {
      data,
      format,
      sampleSize,
    });
    return response.data;
  },

  saveEvaluationResults: async (payload: {
    fileId: string;
    format: string;
    dataGroup: 'all' | number;
    results: Array<{
      rowId: string;
      groupId?: number;
      instruction: string;
      output: string;
      scores: {
        accuracy?: number;
        clarity?: number;
        completeness?: number;
        socratic?: number;
        alignment?: number;
        factuality?: number;
        overall: number;
      };
      reason: string;
    }>;
  }): Promise<{ message: string; id: string }> => {
    const response = await api.post<{ message: string; id: string }>('/evaluate/save', payload);
    return response.data;
  },

  
};