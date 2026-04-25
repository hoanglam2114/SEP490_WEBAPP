const fetchJson = async (
  url: string,
  init?: {
    method?: 'GET' | 'POST' | 'DELETE';
    body?: Record<string, unknown>;
  }
): Promise<{ status: number; data: any }> => {
  const fetchModule = await import('node-fetch');
  const response = await fetchModule.default(url, {
    method: init?.method || 'GET',
    headers: {
      'Content-Type': 'application/json',
      'ngrok-skip-browser-warning': 'true',
    },
    body: init?.body ? JSON.stringify(init.body) : undefined,
  });

  const responseText = await response.text();

  try {
    return {
      status: response.status,
      data: JSON.parse(responseText),
    };
  } catch {
    throw new Error(`GPU service returned non-JSON response: ${responseText.slice(0, 500)}`);
  }
};

export class GpuClient {
  constructor(private readonly baseUrl: string) {}

  visualize(body: Record<string, unknown>) {
    return fetchJson(`${this.baseUrl}/api/cluster/visualize`, {
      method: 'POST',
      body,
    });
  }

  cluster(body: Record<string, unknown>) {
    return fetchJson(`${this.baseUrl}/api/cluster`, {
      method: 'POST',
      body,
    });
  }

  filter(body: Record<string, unknown>) {
    return fetchJson(`${this.baseUrl}/api/cluster/filter`, {
      method: 'POST',
      body,
    });
  }

  removeNoise() {
    return fetchJson(`${this.baseUrl}/api/cluster/remove-noise`, {
      method: 'POST',
    });
  }

  deduplicate(body: Record<string, unknown>) {
    return fetchJson(`${this.baseUrl}/api/cluster/deduplicate`, {
      method: 'POST',
      body,
    });
  }

  clearCache() {
    return fetchJson(`${this.baseUrl}/api/cluster/cache`, {
      method: 'DELETE',
    });
  }
}
