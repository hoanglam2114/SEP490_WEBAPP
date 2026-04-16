import { Request, Response } from 'express';
import fetch from 'node-fetch'; // assuming node-fetch is available based on package.json
import { ChatHistory } from '../models/ChatHistory';
import { OpenRouterProvider } from '../services/providers/OpenRouterProvider';
import { GeminiProvider } from '../services/providers/GeminiProvider';
import { OpenAIProvider } from '../services/providers/OpenAIProvider';
import { DeepseekProvider } from '../services/providers/DeepseekProvider';

const rawGpuUrl = process.env.GPU_SERVICE_URL || 'http://localhost:5000';
// Split by comma and take the first one, or handle based on instanceId
const gpuServiceUrls = rawGpuUrl.split(',').map(url => url.trim().replace(/\/$/, ''));

const getGpuUrl = (instanceId?: number) => {
  if (instanceId && instanceId > 0 && instanceId <= gpuServiceUrls.length) {
    return gpuServiceUrls[instanceId - 1];
  }
  return gpuServiceUrls[0];
};


export const validateModel = async (req: Request, res: Response): Promise<void> => {
  try {
    const { model, provider } = req.body;
    
    if (!provider || provider === 'local') {
      // Local model validation (existing logic if any, or just return ok for now)
      res.json({ valid: true });
      return;
    }

    let llmProvider;
    const normalizedProvider = String(provider).toLowerCase();
    if (normalizedProvider === 'openrouter') llmProvider = new OpenRouterProvider();
    else if (normalizedProvider === 'gemini') llmProvider = new GeminiProvider();
    else if (normalizedProvider === 'openai') llmProvider = new OpenAIProvider();
    else if (normalizedProvider === 'deepseek') llmProvider = new DeepseekProvider();

    if (llmProvider) {
      // Test the model with a very simple, short prompt
      await llmProvider.generateContent('ping', model, 'Respond only with "pong"');
      res.json({ valid: true });
    } else {
      res.status(400).json({ error: 'Provider không hợp lệ' });
    }
  } catch (error: any) {
    console.error('[validateModel] Error:', error.message);
    res.status(400).json({ error: error.message });
  }
};

export const chatWithAI = async (req: Request, res: Response): Promise<void> => {
  try {
    const { 
      text_input, 
      hf_hub_id, 
      message, 
      model, 
      system_prompt, 
      max_new_tokens, 
      temperature, 
      top_k, 
      top_p, 
      repetition_penalty,
      provider // New: external provider like 'openrouter', 'gemini', etc.
    } = req.body;

    const actualMessage = text_input || message;
    const actualModelId = hf_hub_id || model;

    if (!actualMessage) {
      res.status(400).json({ error: 'message là bắt buộc' });
      return;
    }

    // --- CASE 1: External LLM Provider (OpenRouter, Gemini, etc.) ---
    if (provider) {
      let llmProvider;
      const normalizedProvider = String(provider).toLowerCase();
      
      if (normalizedProvider === 'openrouter') {
        llmProvider = new OpenRouterProvider();
      } else if (normalizedProvider === 'gemini') {
        llmProvider = new GeminiProvider();
      } else if (normalizedProvider === 'openai') {
        llmProvider = new OpenAIProvider();
      } else if (normalizedProvider === 'deepseek') {
        llmProvider = new DeepseekProvider();
      }

      if (llmProvider) {
         console.log(`[chatWithAI] Using external provider: ${normalizedProvider}`);
         // If using OpenRouter, we can pass the model ID if it looks like a HF model ID or OpenRouter model ID
         const modelOverride = normalizedProvider === 'openrouter' ? actualModelId : undefined;
         const reply = await llmProvider.generateContent(actualMessage, modelOverride);
         res.json({ reply, result: reply });
         return;
       }
    }

    // --- CASE 2: Fine-tuned Model (Local/GPU Service) ---
    if (!actualModelId) {
      res.status(400).json({ error: 'hf_model_id là bắt buộc khi không dùng external provider' });
      return;
    }

    const { instanceId } = req.body;
    const targetUrl = getGpuUrl(instanceId);
    
    const inferResponse = await fetch(`${targetUrl}/api/infer`, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'ngrok-skip-browser-warning': 'true' 
      },
      body: JSON.stringify({
        hf_model_id: actualModelId,
        text_input: actualMessage,
        instanceId: instanceId ?? 1,
        system_prompt, max_new_tokens, temperature, top_k, top_p, repetition_penalty
      })
    });

    if (!inferResponse.ok) {
      const errorData: any = await inferResponse.json().catch(() => ({}));
      throw new Error(errorData.error || `Lỗi từ GPU service: ${inferResponse.statusText}`);
    }

    const data: any = await inferResponse.json();
    res.json({ reply: data.result || 'Không có phản hồi', result: data.result });

  } catch (error: any) {
    console.error('Chat AI Proxy Error:', error);
    res.status(500).json({ error: error.message || 'Có lỗi xảy ra khi gọi Python inference', details: error.message });
  }
};

export const inferWithAI = async (req: Request, res: Response): Promise<void> => {
  try {
    const { 
      text_input, 
      hf_model_id, 
      system_prompt, 
      max_new_tokens, 
      temperature, 
      top_k, 
      top_p, 
      repetition_penalty,
      provider // New: support external providers
    } = req.body;

    if (!text_input) {
      res.status(400).json({ error: 'text_input là bắt buộc' });
      return;
    }

    // --- CASE 1: External LLM Provider ---
    if (provider) {
      let llmProvider;
      const normalizedProvider = String(provider).toLowerCase();
      if (normalizedProvider === 'openrouter') llmProvider = new OpenRouterProvider();
      else if (normalizedProvider === 'gemini') llmProvider = new GeminiProvider();
      else if (normalizedProvider === 'openai') llmProvider = new OpenAIProvider();
      else if (normalizedProvider === 'deepseek') llmProvider = new DeepseekProvider();

      if (llmProvider) {
        console.log(`[inferWithAI] Using external provider: ${normalizedProvider}`);
        const result = await llmProvider.generateContent(text_input, hf_model_id, system_prompt);
        res.json({ result });
        return;
      }
    }

    // --- CASE 2: GPU Service ---
    if (!hf_model_id) {
      res.status(400).json({ error: 'hf_model_id là bắt buộc khi không dùng external provider' });
      return;
    }

    const { instanceId } = req.body;
    const targetUrl = getGpuUrl(instanceId);

    const inferResponse = await fetch(`${targetUrl}/api/infer`, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'ngrok-skip-browser-warning': 'true' 
      },
      body: JSON.stringify({
        hf_model_id: hf_model_id,
        text_input: text_input,
        instanceId: instanceId ?? 1,
        system_prompt, max_new_tokens, temperature, top_k, top_p, repetition_penalty
      })
    });

    if (!inferResponse.ok) {
      const errorData: any = await inferResponse.json().catch(() => ({}));
      throw new Error(errorData.error || `Lỗi từ Python backend: ${inferResponse.statusText}`);
    }

    const data: any = await inferResponse.json();
    res.json(data); // Phản hồi gồm { "result": "..." }

  } catch (error: any) {
    console.error('Inference AI Proxy Error:', error);
    res.status(500).json({ error: error.message || 'Có lỗi xảy ra khi gọi Python inference', details: error.message });
  }
};

export const chatWithAIStream = async (req: Request, res: Response): Promise<void> => {
  try {
    const { 
      text_input, 
      hf_hub_id, 
      message, 
      model, 
      system_prompt, 
      max_new_tokens, 
      temperature, 
      top_k, 
      top_p, 
      repetition_penalty,
      provider 
    } = req.body;

    const actualMessage = text_input || message;
    const actualModelId = hf_hub_id || model;

    if (!actualMessage) {
      res.status(400).json({ error: 'message là bắt buộc' });
      return;
    }

    // --- CASE 1: External Provider (Non-streaming fallback for now) ---
    if (provider) {
      let llmProvider;
      const normalizedProvider = String(provider).toLowerCase();
      if (normalizedProvider === 'openrouter') llmProvider = new OpenRouterProvider();
      else if (normalizedProvider === 'gemini') llmProvider = new GeminiProvider();
      else if (normalizedProvider === 'openai') llmProvider = new OpenAIProvider();
      else if (normalizedProvider === 'deepseek') llmProvider = new DeepseekProvider();

      if (llmProvider) {
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        res.flushHeaders();

        const modelOverride = normalizedProvider === 'openrouter' ? actualModelId : undefined;
        const reply = await llmProvider.generateContent(actualMessage, modelOverride);
        
        res.write(`data: ${JSON.stringify({ text: reply })}\n\n`);
        res.write(`data: ${JSON.stringify({ is_final: true })}\n\n`);
        res.end();
        return;
      }
    }

    // --- CASE 2: GPU Service Stream ---
    if (!actualModelId) {
      res.status(400).json({ error: 'hf_model_id là bắt buộc khi không dùng external provider' });
      return;
    }

    const { instanceId } = req.body;
    const targetUrl = getGpuUrl(instanceId);
    console.log(`[chatWithAIStream] req.body.instanceId=${JSON.stringify(req.body.instanceId)}, slot=${instanceId ?? 1}`);

    const inferResponse = await fetch(`${targetUrl}/api/infer/stream`, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'ngrok-skip-browser-warning': 'true' 
      },
      body: JSON.stringify({
        hf_model_id: actualModelId,
        text_input: actualMessage,
        instanceId: instanceId ?? 1,
        system_prompt, max_new_tokens, temperature, top_k, top_p, repetition_penalty
      })
    });

    if (!inferResponse.ok) {
      // If not OK, python might not return a stream but a JSON error
      let errorMessage = `Lỗi từ GPU service: ${inferResponse.statusText}`;
      try {
        const errorData: any = await inferResponse.json();
        errorMessage = errorData.error || errorMessage;
      } catch (e) {
        // Ignore JSON parse error on non-ok response
      }
      res.status(inferResponse.status).json({ error: errorMessage });
      return;
    }

    // Set headers for SSE
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    // Pipe the response body from Python server to Express response
    if (inferResponse.body) {
      inferResponse.body.pipe(res, { end: false });
      inferResponse.body.on('end', () => {
        const input_parameters = {
          do_sample: true,
          max_new_tokens,
          repetition_penalty,
          system_prompt,
          temperature,
          text_input: actualMessage,
          top_k,
          top_p
        };
        const finalChunk = JSON.stringify({
          is_final: true,
          input_parameters
        });
        res.write(`data: ${finalChunk}\n\n`);
        res.end();
      });
      inferResponse.body.on('error', (err) => {
        console.error('Stream piping error:', err);
        res.end();
      });
    } else {
      res.status(500).json({ error: 'Không nhận được luồng dữ liệu từ GPU service' });
    }

  } catch (error: any) {
    console.error('Chat AI Stream Proxy Error:', error);
    if (!res.headersSent) {
      res.status(500).json({ error: error.message || 'Có lỗi xảy ra khi gọi Python inference stream', details: error.message });
    } else {
      res.end(`data: ${JSON.stringify({ error: 'Kết nối stream bị gián đoạn: ' + error.message })}\n\n`);
    }
  }
};

export const inferWithAIStream = async (req: Request, res: Response): Promise<void> => {
  try {
    const { 
      text_input, 
      hf_model_id, 
      system_prompt, 
      max_new_tokens, 
      temperature, 
      top_k, 
      top_p, 
      repetition_penalty,
      provider 
    } = req.body;

    if (!text_input) {
      res.status(400).json({ error: 'text_input là bắt buộc' });
      return;
    }

    // --- CASE 1: External Provider (Non-streaming fallback) ---
    if (provider) {
      let llmProvider;
      const normalizedProvider = String(provider).toLowerCase();
      if (normalizedProvider === 'openrouter') llmProvider = new OpenRouterProvider();
      else if (normalizedProvider === 'gemini') llmProvider = new GeminiProvider();
      else if (normalizedProvider === 'openai') llmProvider = new OpenAIProvider();
      else if (normalizedProvider === 'deepseek') llmProvider = new DeepseekProvider();

      if (llmProvider) {
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        res.flushHeaders();

        const result = await llmProvider.generateContent(text_input, hf_model_id, system_prompt);
        res.write(`data: ${JSON.stringify({ text: result })}\n\n`);
        res.write(`data: ${JSON.stringify({ is_final: true })}\n\n`);
        res.end();
        return;
      }
    }

    // --- CASE 2: GPU Service Stream ---
    if (!hf_model_id) {
      res.status(400).json({ error: 'hf_model_id là bắt buộc khi không dùng external provider' });
      return;
    }

    const { instanceId } = req.body;
    const targetUrl = getGpuUrl(instanceId);
    console.log(`[inferWithAIStream] req.body.instanceId=${JSON.stringify(req.body.instanceId)}, slot=${instanceId ?? 1}`);

    const inferResponse = await fetch(`${targetUrl}/api/infer/stream`, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'ngrok-skip-browser-warning': 'true' 
      },
      body: JSON.stringify({
        hf_model_id: hf_model_id,
        text_input: text_input,
        instanceId: instanceId ?? 1,
        system_prompt, max_new_tokens, temperature, top_k, top_p, repetition_penalty
      })
    });

    if (!inferResponse.ok) {
      let errorMessage = `Lỗi từ Python backend: ${inferResponse.statusText}`;
      try {
        const errorData: any = await inferResponse.json();
        errorMessage = errorData.error || errorMessage;
      } catch (e) {
        // Ignore JSON parse error on non-ok response
      }
      res.status(inferResponse.status).json({ error: errorMessage });
      return;
    }

    // Set headers for SSE
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    // Pipe the response body
    if (inferResponse.body) {
      inferResponse.body.pipe(res, { end: false });
      inferResponse.body.on('end', () => {
        const input_parameters = {
          do_sample: true,
          max_new_tokens,
          repetition_penalty,
          system_prompt,
          temperature,
          text_input,
          top_k,
          top_p
        };
        const finalChunk = JSON.stringify({
          is_final: true,
          input_parameters
        });
        res.write(`data: ${finalChunk}\n\n`);
        res.end();
      });
      inferResponse.body.on('error', (err) => {
        console.error('Stream piping error:', err);
        res.end();
      });
    } else {
      res.status(500).json({ error: 'Không nhận được luồng dữ liệu từ GPU service' });
    }

  } catch (error: any) {
    console.error('Inference AI Stream Proxy Error:', error);
    if (!res.headersSent) {
      res.status(500).json({ error: error.message || 'Có lỗi xảy ra khi gọi Python inference stream', details: error.message });
    } else {
      // Send the raw error message so the UI can display it
      res.write(`data: ${JSON.stringify({ error: error.message })}\n\n`);
      res.end();
    }
  }
};

export const saveChatHistory = async (req: Request, res: Response): Promise<void> => {
  try {
    const { userMessage, aiMessage, model, responseTime } = req.body;
    
    if (!userMessage || !aiMessage || !model || responseTime === undefined) {
      res.status(400).json({ error: 'Missing required fields' });
      return;
    }

    const newHistory = new ChatHistory({
      userMessage,
      aiMessage,
      model,
      responseTime
    });

    await newHistory.save();
    res.status(201).json({ message: 'Saved successfully', data: newHistory });
  } catch (error: any) {
    console.error('Save Chat History Error:', error);
    res.status(500).json({ error: 'Failed to save chat history', details: error.message });
  }
};

export const getChatHistory = async (req: Request, res: Response): Promise<void> => {
  try {
    const limit = parseInt(req.query.limit as string) || 20;
    const history = await ChatHistory.find()
      .sort({ createdAt: -1 })
      .limit(limit);
      
    res.json(history);
  } catch (error: any) {
    console.error('Get Chat History Error:', error);
    res.status(500).json({ error: 'Failed to fetch chat history', details: error.message });
  }
};

export const loadModel = async (req: Request, res: Response): Promise<void> => {
  try {
    const { hf_model_id, system_prompt, max_new_tokens, temperature, top_k, top_p, repetition_penalty } = req.body;

    if (!hf_model_id) {
      res.status(400).json({ error: 'hf_model_id là bắt buộc' });
      return;
    }

    const { instanceId } = req.body;
    const targetUrl = getGpuUrl(instanceId);
    console.log(`[loadModel] req.body.instanceId=${JSON.stringify(req.body.instanceId)}, resolved slot=${instanceId ?? 1}, url=${targetUrl}`);

    const loadResponse = await fetch(`${targetUrl}/api/model/load`, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'ngrok-skip-browser-warning': 'true' 
      },
      body: JSON.stringify({ hf_model_id, instance_id: instanceId ?? 1, system_prompt, max_new_tokens, temperature, top_k, top_p, repetition_penalty })
    });

    if (!loadResponse.ok) {
      const errorData: any = await loadResponse.json().catch(() => ({}));
      throw new Error(errorData.error || `Lỗi từ Python backend: ${loadResponse.statusText}`);
    }

    const data: any = await loadResponse.json();
    res.json(data);

  } catch (error: any) {
    console.error('Load Model Proxy Error:', error);
    res.status(500).json({ error: error.message || 'Có lỗi xảy ra khi gọi Python model load', details: error.message });
  }
};

export const getInferenceLogs = async (req: Request, res: Response): Promise<void> => {
  try {
    const { inference_id, instanceId } = req.query;
    const targetUrl = getGpuUrl(instanceId ? Number(instanceId) : undefined);
    
    let url = `${targetUrl}/api/infer/logs`;
    if (inference_id) {
      url += `/${inference_id}`;
    }

    const response = await fetch(url, {
      headers: {
        'ngrok-skip-browser-warning': 'true'
      }
    });
    
    if (!response.ok) {
      const errorData: any = await response.json().catch(() => ({}));
      throw new Error(errorData.error || `Lỗi từ Python backend: ${response.statusText}`);
    }

    const data = await response.json();
    res.json(data);
  } catch (error: any) {
    console.error('Get Inference Logs Proxy Error:', error);
    res.status(500).json({ error: error.message || 'Có lỗi xảy ra khi gọi Python logs', details: error.message });
  }
};