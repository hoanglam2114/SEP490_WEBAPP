import { Request, Response } from 'express';
import fetch from 'node-fetch'; // assuming node-fetch is available based on package.json

const gpuServiceUrl = process.env.GPU_SERVICE_URL ? process.env.GPU_SERVICE_URL.replace(/\/$/, '') : 'http://localhost:5000';
const PYTHON_INFERENCE_URL = `${gpuServiceUrl}/api/infer`;

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

    const inferResponse = await fetch(PYTHON_INFERENCE_URL, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'ngrok-skip-browser-warning': 'true' 
      },
      body: JSON.stringify({
        hf_model_id: actualModelId,
        text_input: actualMessage,
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
    res.status(500).json({ error: 'Có lỗi xảy ra khi gọi Python inference', details: error.message });
  }
};

export const inferWithAI = async (req: Request, res: Response): Promise<void> => {
  try {
    const { text_input, hf_model_id, system_prompt, max_new_tokens, temperature, top_k, top_p, repetition_penalty } = req.body;

    if (!text_input || !hf_model_id) {
      res.status(400).json({ error: 'text_input và hf_model_id là bắt buộc' });
      return;
    }

    const inferResponse = await fetch(PYTHON_INFERENCE_URL, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'ngrok-skip-browser-warning': 'true' 
      },
      body: JSON.stringify({
        hf_model_id: hf_model_id,
        text_input: text_input,
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
    res.status(500).json({ error: 'Có lỗi xảy ra khi gọi Python inference', details: error.message });
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

    const inferResponse = await fetch(`${PYTHON_INFERENCE_URL}/stream`, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'ngrok-skip-browser-warning': 'true' 
      },
      body: JSON.stringify({
        hf_model_id: actualModelId,
        text_input: actualMessage,
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
      inferResponse.body.pipe(res);
    } else {
      res.status(500).json({ error: 'Không nhận được luồng dữ liệu từ GPU service' });
    }

  } catch (error: any) {
    console.error('Chat AI Stream Proxy Error:', error);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Có lỗi xảy ra khi gọi Python inference stream', details: error.message });
    } else {
      res.end(`data: ${JSON.stringify({ error: 'Kết nối stream bị gián đoạn' })}\n\n`);
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

    const inferResponse = await fetch(`${PYTHON_INFERENCE_URL}/stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        hf_model_id: hf_model_id,
        text_input: text_input,
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
      inferResponse.body.pipe(res);
    } else {
      res.status(500).json({ error: 'Không nhận được luồng dữ liệu từ GPU service' });
    }

  } catch (error: any) {
    console.error('Inference AI Stream Proxy Error:', error);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Có lỗi xảy ra khi gọi Python inference stream', details: error.message });
    } else {
      res.end(`data: ${JSON.stringify({ error: 'Kết nối stream bị gián đoạn' })}\n\n`);
    }
  }
};