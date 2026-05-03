import dotenv from 'dotenv';
dotenv.config();

class ConfigService {
  private gpuUrls: string[];
  private gpuCleared: boolean = false;

  constructor() {
    const raw = process.env.GPU_SERVICE_URL || '';
    this.gpuUrls = raw ? raw.split(',').map(url => url.trim().replace(/\/$/, '')) : [];
  }

  getGpuUrl(instanceId?: number): string {
    if (!this.gpuUrls.length) return '';
    if (instanceId && instanceId > 0 && instanceId <= this.gpuUrls.length) {
      return this.gpuUrls[instanceId - 1];
    }
    return this.gpuUrls[0];
  }

  getGpuUrls(): string[] {
    return this.gpuUrls;
  }

  isGpuConfigured(): boolean {
    return this.gpuUrls.length > 0 && !this.gpuCleared;
  }

  setGpuUrlStr(urlStr: string) {
    if (!urlStr || urlStr.trim() === '') {
      return;
    }
    this.gpuCleared = false;
    this.gpuUrls = urlStr.split(',').map(url => url.trim().replace(/\/$/, ''));
    console.log('[ConfigService] GPU_SERVICE_URL updated to:', this.gpuUrls);
  }

  clearGpuUrl() {
    this.gpuUrls = [];
    this.gpuCleared = true;
    console.log('[ConfigService] GPU_SERVICE_URL cleared.');
  }
}

export const configService = new ConfigService();
