import { Request, Response } from 'express';
import { configService } from '../services/configService';

export const getGpuConfig = (_req: Request, res: Response) => {
  const gpuUrl = configService.getGpuUrls().join(', ');
  res.json({
    gpuUrl,
    configured: configService.isGpuConfigured(),
  });
};

export const updateGpuConfig = (req: Request, res: Response) => {
  const { gpuUrl } = req.body;
  if (typeof gpuUrl === 'string') {
    if (gpuUrl.trim() === '') {
      configService.clearGpuUrl();
      res.json({ success: true, gpuUrl: '', configured: false });
    } else {
      configService.setGpuUrlStr(gpuUrl);
      res.json({ success: true, gpuUrl: configService.getGpuUrls().join(', '), configured: true });
    }
  } else {
    res.status(400).json({ error: 'Invalid gpuUrl format' });
  }
};
