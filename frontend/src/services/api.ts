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

function chunkArray<T>(items: T[], chunkSize: number): T[][] {
  if (chunkSize <= 0) {
    return [items];
  }
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += chunkSize) {
    chunks.push(items.slice(i, i + chunkSize));
  }
  return chunks;
}

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
      } catch (e) { }
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

  getInferenceLogs: async (instanceId?: number, inference_id?: string) => {
    const params: any = {};
    if (instanceId !== undefined) params.instanceId = instanceId;
    if (inference_id) params.inference_id = inference_id;
    const response = await api.get("/infer/logs", { params });
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
    provider: 'gemini' | 'openai' | 'deepseek' = 'gemini'
  ): Promise<EvaluationResult> => {
    const response = await api.post<EvaluationResult>('/evaluate', {
      data,
      format,
      provider,
    });
    return response.data;
  },

  evaluateDataChunked: async (
    data: any[],
    format?: string,
    provider: 'gemini' | 'openai' | 'deepseek' = 'gemini',
    chunkSize = 100
  ): Promise<EvaluationResult> => {
    if (!Array.isArray(data) || data.length === 0) {
      return {
        sampleSize: 0,
        evaluated: 0,
        totalPopulation: 0,
        avgScores: { overall: 0 },
        passRate: 0,
        samples: [],
      };
    }

    if (data.length <= chunkSize) {
      return apiService.evaluateData(data, format, provider);
    }

    const chunks = chunkArray(data, chunkSize);
    const results = await Promise.all(
      chunks.map((chunk) => apiService.evaluateData(chunk, format, provider))
    );

    const samples = results.flatMap((item) => item.samples || []);
    const evaluated = results.reduce((sum, item) => sum + (item.evaluated || 0), 0);
    const totalPopulation = results.reduce((sum, item) => sum + (item.totalPopulation || 0), 0);
    const totalPass = results.reduce((sum, item) => sum + ((item.passRate || 0) * (item.evaluated || 0)), 0);

    const totals = samples.reduce(
      (acc, sample) => ({
        accuracy: acc.accuracy + (sample.scores.accuracy || 0),
        clarity: acc.clarity + (sample.scores.clarity || 0),
        completeness: acc.completeness + (sample.scores.completeness || 0),
        socratic: acc.socratic + (sample.scores.socratic || 0),
        encouragement: acc.encouragement + (sample.scores.encouragement || 0),
        factuality: acc.factuality + (sample.scores.factuality || 0),
        overall: acc.overall + (sample.scores.overall || 0),
      }),
      { accuracy: 0, clarity: 0, completeness: 0, socratic: 0, encouragement: 0, factuality: 0, overall: 0 }
    );

    const divisor = Math.max(samples.length, 1);
    return {
      sampleSize: samples.length,
      evaluated,
      totalPopulation,
      avgScores: {
        accuracy: totals.accuracy / divisor,
        clarity: totals.clarity / divisor,
        completeness: totals.completeness / divisor,
        socratic: totals.socratic / divisor,
        encouragement: totals.encouragement / divisor,
        factuality: totals.factuality / divisor,
        overall: totals.overall / divisor,
      },
      passRate: evaluated > 0 ? totalPass / evaluated : 0,
      samples,
    };
  },

  refineData: async (
    data: Array<{ assistant: string | Array<{ user: string; assistant: string }>; reason: string }>,
    provider: 'gemini' | 'openai' | 'deepseek' = 'gemini'
  ): Promise<{ items: Array<{ assistant: string | Array<{ user: string; assistant: string }>; refinedOutput: string | Array<{ user: string; assistant: string }> }>; refined: number }> => {
    const response = await api.post('/evaluate/refine', { data, provider });
    return response.data;
  },

  refineDataChunked: async (
    data: Array<{ assistant: string | Array<{ user: string; assistant: string }>; reason: string }>,
    provider: 'gemini' | 'openai' | 'deepseek' = 'gemini',
    chunkSize = 100
  ): Promise<{ items: Array<{ assistant: string | Array<{ user: string; assistant: string }>; refinedOutput: string | Array<{ user: string; assistant: string }> }>; refined: number }> => {
    if (!Array.isArray(data) || data.length === 0) {
      return { items: [], refined: 0 };
    }

    if (data.length <= chunkSize) {
      return apiService.refineData(data, provider);
    }

    const chunks = chunkArray(data, chunkSize);
    const results = await Promise.all(chunks.map((chunk) => apiService.refineData(chunk, provider)));

    return {
      items: results.flatMap((item) => item.items || []),
      refined: results.reduce((sum, item) => sum + (item.refined || 0), 0),
    };
  },

  saveEvaluationResults: async (payload: {
    fileId?: string;
    projectName?: string;
    datasetVersionId?: string;
    items: Array<{
      sampleId: string;
      evaluatedBy: 'manual' | 'gemini' | 'openai' | 'deepseek' | 'none';
      results: {
        accuracy?: number | null;
        clarity?: number | null;
        completeness?: number | null;
        socratic?: number | null;
        encouragement?: number | null;
        factuality?: number | null;
        overall: number | null;
        reason: string;
      };
      createdAt: string;
    }>;
  }): Promise<{ message: string; insertedCount: number }> => {
    const response = await api.post<{ message: string; insertedCount: number }>('/evaluate/save', payload);
    return response.data;
  },

  createDatasetVersion: async (payload: {
    projectName: string;
    similarityThreshold: number;
    format: 'openai' | 'alpaca';
    data: Array<Record<string, any>>;
  }): Promise<{
    message: string;
    datasetVersion: {
      _id: string;
      projectName: string;
      versionName: string;
      similarityThreshold: number;
      totalSamples: number;
      createdAt: string;
    };
    sampleIdMap: Record<string, string>;
  }> => {
    const response = await api.post('/dataset-versions/create', payload);
    return response.data;
  },

  getDatasetVersionDetail: async (id: string): Promise<{
    datasetVersion: {
      _id: string;
      projectName: string;
      versionName: string;
      similarityThreshold: number;
      totalSamples: number;
      createdAt: string;
    };
    items: Array<{
      _id: string;
      sampleId: string;
      sampleKey: string;
      data: Record<string, any>;
      evaluatedBy: 'manual' | 'gemini' | 'openai' | 'deepseek' | 'none';
      results: {
        accuracy?: number | null;
        clarity?: number | null;
        completeness?: number | null;
        socratic?: number | null;
        encouragement?: number | null;
        factuality?: number | null;
        overall: number | null;
        reason: string;
      };
      evaluations?: Array<{
        evaluatedBy: 'manual' | 'gemini' | 'openai' | 'deepseek' | 'none';
        scores: {
          accuracy?: number | null;
          clarity?: number | null;
          completeness?: number | null;
          socratic?: number | null;
          encouragement?: number | null;
          factuality?: number | null;
          overall: number | null;
          reason: string;
        };
        reason?: string;
        timestamp?: string;
      }>;
      createdAt: string;
      updatedAt?: string;
    }>;
  }> => {
    const response = await api.get(`/dataset-versions/${id}`);
    return response.data;
  },

  deleteDatasetVersionItem: async (sampleId: string): Promise<{ message: string; deletedSampleId: string }> => {
    const response = await api.delete(`/dataset-versions/items/${sampleId}`);
    return response.data;
  },

  getEvaluationHistory: async (params: {
    page: number;
    limit: number;
    projectSearch?: string;
  }): Promise<{
    projects: Array<{
      projectName: string;
      versionCount: number;
      totalSamples: number;
      latestCreatedAt: string;
      versions: Array<{
        _id: string;
        versionName: string;
        similarityThreshold: number;
        totalSamples: number;
        createdAt: string;
        evaluatedCount: number;
        avgOverall: number | null;
      }>;
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
        ...(params.projectSearch ? { projectSearch: params.projectSearch } : {}),

      },
    });
    return response.data;
  },

  updateEvaluationHistory: async (
    id: string,
    payload: {
      results: {
        accuracy?: number | null;
        clarity?: number | null;
        completeness?: number | null;
        socratic?: number | null;
        encouragement?: number | null;
        factuality?: number | null;
        overall: number | null;
        reason: string;
      };
      evaluatedBy: 'manual' | 'gemini' | 'openai' | 'deepseek' | 'none';
    }
  ): Promise<{ message: string; item: any }> => {
    const response = await api.patch(`/evaluate/history/${id}`, payload);
    return response.data;
  },

  clusterData: (
    data: any[],
    k?: number,
    eps?: number,
    minSamples?: number
  ): Promise<{
    data: any[];
    groups: any[];
    assignments: number[];
  }> =>
    api
      .post('/cluster', {
        data,
        k,
        eps,
        min_samples: minSamples,
      })
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

  clusterVisualize: (
    data: any[],
    maxK: number = 20,
    eps: number = 0.15,
    minSamples: number = 6
  ): Promise<{
    elbow: Array<{ k: number; wcss: number }>;
    kDistance: Array<{ rank: number; distance: number }>;
    pointCount: number;
    noiseCount?: number;
  }> =>
    api
      .post('/cluster/visualize', { data, max_k: maxK, eps, min_samples: minSamples })
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
