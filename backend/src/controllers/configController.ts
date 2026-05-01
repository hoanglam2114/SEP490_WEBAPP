import { Request, Response } from 'express';
import { configService } from '../services/configService';

export const getGpuConfig = (_req: Request, res: Response) => {
  res.json({ gpuUrl: configService.getGpuUrls().join(', ') });
};

export const updateGpuConfig = (req: Request, res: Response) => {
  const { gpuUrl } = req.body;
  if (typeof gpuUrl === 'string') {
    configService.setGpuUrlStr(gpuUrl);
    res.json({ success: true, gpuUrl: configService.getGpuUrls().join(', ') });
  } else {
    res.status(400).json({ error: 'Invalid gpuUrl format' });
  }
};
