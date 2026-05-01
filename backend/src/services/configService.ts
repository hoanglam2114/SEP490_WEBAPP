import dotenv from 'dotenv';
dotenv.config();

class ConfigService {
  private gpuUrls: string[];

  constructor() {
    const raw = process.env.GPU_SERVICE_URL || 'http://localhost:5000';
    this.gpuUrls = raw.split(',').map(url => url.trim().replace(/\/$/, ''));
  }

  getGpuUrl(instanceId?: number): string {
    if (instanceId && instanceId > 0 && instanceId <= this.gpuUrls.length) {
      return this.gpuUrls[instanceId - 1];
    }
    return this.gpuUrls[0];
  }

  getGpuUrls(): string[] {
    return this.gpuUrls;
  }

  setGpuUrlStr(urlStr: string) {
    if (!urlStr || urlStr.trim() === '') {
        return;
    }
    this.gpuUrls = urlStr.split(',').map(url => url.trim().replace(/\/$/, ''));
    console.log('[ConfigService] GPU_SERVICE_URL updated to:', this.gpuUrls);
  }
}

export const configService = new ConfigService();
