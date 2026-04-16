import { Request, Response } from 'express';
import fetch from 'node-fetch'; // assuming node-fetch is available based on package.json
import { ChatHistory } from '../models/ChatHistory';

const gpuServiceUrl = process.env.GPU_SERVICE_URL ? process.env.GPU_SERVICE_URL.replace(/\/$/, '') : 'http://localhost:5000';
// Single Colab handles both slots via instance_id in body — GPU_SERVICE_URL_2 no longer needed.
const getGpuUrl = (_instanceId?: number) => gpuServiceUrl;


export const chatWithAI = async (req: Request, res: Response): Promise<void> => {
  // Hàm này giờ đây sẽ bị deprecate hoặc dùng làm proxy tới Python infer endpoint mượt hơn
  try {
    const { text_input, hf_hub_id, message, model, system_prompt, max_new_tokens, temperature, top_k, top_p, repetition_penalty } = req.body;

    // Hỗ trợ cả payload cũ và mới
    const actualMessage = text_input || message;
    const actualModelId = hf_hub_id || model;

    if (!actualMessage || !actualModelId) {
      res.status(400).json({ error: 'text_input và hf_model_id là bắt buộc' });
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
    const { text_input, hf_model_id, system_prompt, max_new_tokens, temperature, top_k, top_p, repetition_penalty } = req.body;

    if (!text_input || !hf_model_id) {
      res.status(400).json({ error: 'text_input và hf_model_id là bắt buộc' });
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
    const { text_input, hf_hub_id, message, model, system_prompt, max_new_tokens, temperature, top_k, top_p, repetition_penalty } = req.body;

    // Support both old and new payload formats
    const actualMessage = text_input || message;
    const actualModelId = hf_hub_id || model;

    if (!actualMessage || !actualModelId) {
      res.status(400).json({ error: 'text_input và hf_model_id là bắt buộc' });
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
    const { text_input, hf_model_id, system_prompt, max_new_tokens, temperature, top_k, top_p, repetition_penalty } = req.body;

    if (!text_input || !hf_model_id) {
      res.status(400).json({ error: 'text_input và hf_model_id là bắt buộc' });
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
      res.end(`data: ${JSON.stringify({ error: 'Kết nối stream bị gián đoạn: ' + error.message })}\n\n`);
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