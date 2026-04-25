/**
 * gpuConfig.ts
 * Module dùng chung để quản lý GPU Service URL tại runtime.
 * Thay vì đọc cứng từ env lúc khởi động, các controller import từ đây
 * để luôn dùng URL mới nhất khi người dùng cập nhật qua API.
 */

let _gpuServiceUrl: string = process.env.GPU_SERVICE_URL || '';

export function getGpuServiceUrl(): string {
  return _gpuServiceUrl;
}

export function setGpuServiceUrl(url: string): void {
  _gpuServiceUrl = url.trim().replace(/\/$/, '');
}

/** Trả về mảng URL (hỗ trợ comma-separated cho multi-worker) */
export function getGpuServiceUrls(): string[] {
  return _gpuServiceUrl
    .split(',')
    .map(u => u.trim().replace(/\/$/, ''))
    .filter(Boolean);
}
