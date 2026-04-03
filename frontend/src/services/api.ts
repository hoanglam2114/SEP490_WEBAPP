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

  inferStream: async (
    text_input: string,
    hf_model_id: string = "",
    options: {
      system_prompt?: string;
      max_new_tokens?: number;
      temperature?: number;
      top_k?: number;
      top_p?: number;
      repetition_penalty?: number;
      signal?: AbortSignal;
      onFinalInfo?: (info: any) => void;
    } = {},
    onChunk: (text: string) => void
  ) => {
    const { signal, onFinalInfo, ...restOptions } = options;
    const response = await fetch(`${API_BASE_URL}/infer/stream`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept": "text/event-stream",
      },
      body: JSON.stringify({ text_input, hf_model_id, ...restOptions }),
      signal,
    });

    if (!response.ok) {
      let errMsg = `HTTP error! status: ${response.status}`;
      try {
        const errJson = await response.json();
        if (errJson.error) errMsg = errJson.error;
      } catch (e) {}
      throw new Error(errMsg);
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
            continue;
          }

          if (dataText) {
            try {
              const dataObj = JSON.parse(dataText);
              if (dataObj.error) {
                throw new Error(dataObj.error);
              }
              if (dataObj.is_final && onFinalInfo) {
                onFinalInfo(dataObj);
              } else if (dataObj.text) {
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

  loadModel: async (hf_model_id: string, options?: any) => {
    const response = await api.post("/model/load", { hf_model_id, ...options });
    return response.data;
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
    items: Array<{
      format: string;
      data: Record<string, any>;
      evaluatedBy: 'manual' | 'gemini';
      results: {
        accuracy?: number;
        clarity?: number;
        completeness?: number;
        socratic?: number;
        alignment?: number;
        factuality?: number;
        overall: number;
        reason: string;
      };
      createdAt: string;
    }>;
  }): Promise<{ message: string; insertedCount: number }> => {
    const response = await api.post<{ message: string; insertedCount: number }>('/evaluate/save', payload);
    return response.data;
  },

  getEvaluationHistory: async (params: {
    page: number;
    limit: number;
    format?: 'openai' | 'alpaca';
  }): Promise<{
    items: Array<{
      _id: string;
      fileId: string;
      format: 'openai' | 'alpaca';
      data: Record<string, any>;
      evaluatedBy: 'manual' | 'gemini';
      results: {
        accuracy?: number;
        clarity?: number;
        completeness?: number;
        socratic?: number;
        alignment?: number;
        factuality?: number;
        overall: number;
        reason: string;
      };
      createdAt: string;
      updatedAt?: string;
    }>;
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  }> => {
    const response = await api.get('/evaluate/history', {
      params: {
        page: params.page,
        limit: params.limit,
        ...(params.format ? { format: params.format } : {}),
      },
    });
    return response.data;
  },

  updateEvaluationHistory: async (
    id: string,
    payload: {
      results: {
        accuracy?: number;
        clarity?: number;
        completeness?: number;
        socratic?: number;
        alignment?: number;
        factuality?: number;
        overall: number;
        reason: string;
      };
      evaluatedBy: 'manual' | 'gemini';
    }
  ): Promise<{ message: string; item: any }> => {
    const response = await api.patch(`/evaluate/history/${id}`, payload);
    return response.data;
  },

  clusterData: (data: any[]): Promise<{
    data: any[];
    groups: any[];
    assignments: number[];
  }> =>
    api
      .post('/cluster', { data })
      .then((res) => res.data),

  clusterFilter: (
    data: any[],
    threshold?: number
  ): Promise<{
    data: any[];
    groups: any[];
    assignments: number[];
  }> =>
    api
      .post('/cluster/filter', { data, threshold })
      .then((res) => res.data),

  deleteClusterCache: (): Promise<any> =>
    api
      .delete('/cluster/cache')
      .then((res) => res.data),

  getChatSessions: async (limit = 30): Promise<any[]> => {
    const response = await api.get('/chat/sessions', { params: { limit } });
    return response.data;
  },

  getChatSessionById: async (id: string): Promise<any> => {
    const response = await api.get(`/chat/sessions/${id}`);
    return response.data;
  },

  createChatSession: async (payload: {
    userMessage: string;
    aiMessage: string;
    model: string;
    responseTime: number;
  }): Promise<any> => {
    const response = await api.post('/chat/sessions', payload);
    return response.data;
  },

  appendMessageToSession: async (id: string, payload: {
    userMessage: string;
    aiMessage: string;
    model: string;
    responseTime: number;
  }): Promise<any> => {
    const response = await api.put(`/chat/sessions/${id}`, payload);
    return response.data;
  },

  deleteChatSession: async (id: string): Promise<any> => {
    const response = await api.delete(`/chat/sessions/${id}`);
    return response.data;
  },
};
