import { Request, Response } from 'express';
import fetch from 'node-fetch';
import { getGpuServiceUrl, setGpuServiceUrl } from '../utils/gpuConfig';
import { rebuildWorkerManager } from './trainController';

/**
 * GET /api/gpu/config
 * Trả về URL hiện tại và trạng thái kết nối.
 */
export const getGpuConfig = async (_req: Request, res: Response) => {
  const url = getGpuServiceUrl();

  if (!url) {
    return res.json({ connected: false, url: '' });
  }

  try {
    const resp = await fetch(`${url}/api/system-eval/resources`, {
      headers: { 'ngrok-skip-browser-warning': 'true' },
      signal: AbortSignal.timeout(5000),
    });
    const connected = resp.ok;
    return res.json({ connected, url });
  } catch {
    return res.json({ connected: false, url });
  }
};

/**
 * POST /api/gpu/config
 * Body: { url: string }
 * Cập nhật GPU URL runtime và kiểm tra kết nối ngay.
 */
export const updateGpuConfig = async (req: Request, res: Response) => {
  const { url } = req.body as { url?: string };

  if (!url || typeof url !== 'string' || !url.trim()) {
    return res.status(400).json({ error: 'url là bắt buộc' });
  }

  const trimmed = url.trim().replace(/\/$/, '');

  try {
    const resp = await fetch(`${trimmed}/api/system-eval/resources`, {
      headers: { 'ngrok-skip-browser-warning': 'true' },
      signal: AbortSignal.timeout(6000),
    });

    if (!resp.ok) {
      return res.status(502).json({ error: 'gpu_offline', message: 'GPU không phản hồi tại URL này' });
    }

    setGpuServiceUrl(trimmed);
    rebuildWorkerManager();
    return res.json({ connected: true, url: trimmed });
  } catch (err: any) {
    return res.status(502).json({ error: 'gpu_offline', message: 'Không thể kết nối tới GPU: ' + (err?.message ?? '') });
  }
};

/**
 * DELETE /api/gpu/config
 * Ngắt kết nối GPU (xoá URL khỏi bộ nhớ).
 */
export const disconnectGpu = (_req: Request, res: Response) => {
  setGpuServiceUrl('');
  rebuildWorkerManager();
  return res.json({ connected: false, url: '' });
};
