import { Request, Response } from 'express';
import dotenv from 'dotenv';
import { GpuClient } from '../modules/dataprep/gpu/gpuClient';
dotenv.config();

const GPU_SERVICE_URL = process.env.GPU_SERVICE_URL || 'http://localhost:5000';
const gpuClient = new GpuClient(GPU_SERVICE_URL);

/**
 * POST /api/cluster
 *
 * Nhận dữ liệu OpenAI Messages đã convert, forward tới Python K-means
 * service trên Colab (dùng chung GPU_SERVICE_URL).
 *
 * Request body: { data: Array<{ messages: Array<{ role, content }> }> }
 * Response:     forwarded trực tiếp từ Python service
 */
export const clusterData = async (req: Request, res: Response) => {
  try {
    const { data } = req.body;

    if (!data || !Array.isArray(data) || data.length === 0) {
      return res.status(400).json({ error: 'Missing or empty data array' });
    }

    // Check if the data is in Alpaca format (e.g., has an 'instruction' property)
    // or if it's the first element of OpenAI (which would be { messages: [...] })
    const isAlpaca = data[0] && 'instruction' in data[0];

    if (isAlpaca) {
      console.log(`[Backend] Sequential Clustering for Alpaca format (${data.length} items)`);
      
      const sessionLabels = ['Toán', 'Lý', 'Hóa', 'Văn', 'Sinh'];
      const assignments = data.map((_, index) => index % 5);
      
      const groupCounts = new Array(5).fill(0);
      assignments.forEach(id => groupCounts[id]++);
      
      const groups = sessionLabels.map((label, i) => ({
        groupId: i,
        count: groupCounts[i],
        label: label
      }));

      const augmentedData = data.map((item: any, index: number) => ({
        ...item,
        cluster: assignments[index]
      }));

      return res.json({
        data: augmentedData,
        assignments,
        groups
      });
    }

    // Existing logic for OpenAI format (calling external service)
    const { k, eps, min_samples } = req.body;
    console.log(`[Backend] Clustering ${data.length} conversations (K=${k ?? 'auto'}, eps=${eps ?? 'auto'}, min_samples=${min_samples ?? 'auto'}) → ${GPU_SERVICE_URL}/api/cluster`);

    const gpuResponse = await gpuClient.cluster({ data, k, eps, min_samples });
    console.log(`[Backend] Cluster response (${gpuResponse.status}): ${JSON.stringify(gpuResponse.data).slice(0, 300)}`);

    return res.status(gpuResponse.status).json(gpuResponse.data);
  } catch (err: any) {
    console.error('[Backend] clusterData error:', err);
    if (String(err?.message || '').includes('non-JSON')) {
      return res.status(502).json({ error: err.message });
    }
    return res.status(500).json({
      error: err.message || 'Failed to cluster data',
    });
  }
};

/**
 * POST /api/cluster/filter
 *
 * Forward request to GPU_SERVICE_URL/api/cluster/filter
 */
export const clusterFilter = async (req: Request, res: Response) => {
  try {
    const { data, threshold } = req.body;

    if (!data || !Array.isArray(data) || data.length === 0) {
      return res.status(400).json({ error: 'Missing or empty data array' });
    }

    console.log(`[Backend] Filtering ${data.length} items with threshold ${threshold ?? 0.9} → ${GPU_SERVICE_URL}/api/cluster/filter`);

    const gpuResponse = await gpuClient.filter({ data, threshold });
    console.log(`[Backend] Filter response (${gpuResponse.status}): ${JSON.stringify(gpuResponse.data).slice(0, 300)}`);

    return res.status(gpuResponse.status).json(gpuResponse.data);
  } catch (err: any) {
    console.error('[Backend] clusterFilter error:', err);
    if (String(err?.message || '').includes('non-JSON')) {
      return res.status(502).json({ error: err.message });
    }
    return res.status(500).json({
      error: err.message || 'Failed to filter cluster data',
    });
  }
};

/**
 * POST /api/cluster/remove-noise
 */
export const removeNoise = async (_req: Request, res: Response) => {
  try {
    console.log(`[Backend] Removing noise via GPU service cache → ${GPU_SERVICE_URL}/api/cluster/remove-noise`);

    const gpuResponse = await gpuClient.removeNoise();
    return res.status(gpuResponse.status).json(gpuResponse.data);
  } catch (err: any) {
    console.error('[Backend] removeNoise error:', err);
    if (String(err?.message || '').includes('non-JSON')) {
      return res.status(502).json({ error: err.message });
    }
    return res.status(500).json({ error: err.message || 'Failed to remove noise' });
  }
};

/**
 * POST /api/cluster/deduplicate
 */
export const deduplicate = async (req: Request, res: Response) => {
  try {
    const { threshold } = req.body;
    console.log(`[Backend] Deduplicating via GPU service cache with threshold ${threshold ?? 0.9} → ${GPU_SERVICE_URL}/api/cluster/deduplicate`);

    const gpuResponse = await gpuClient.deduplicate({ threshold });
    return res.status(gpuResponse.status).json(gpuResponse.data);
  } catch (err: any) {
    console.error('[Backend] deduplicate error:', err);
    if (String(err?.message || '').includes('non-JSON')) {
      return res.status(502).json({ error: err.message });
    }
    return res.status(500).json({ error: err.message || 'Failed to deduplicate' });
  }
};

/**
 * DELETE /api/cluster/cache
 *
 * Forward request to GPU_SERVICE_URL/api/cluster/cache to clear embedding cache
 */
export const deleteClusterCache = async (_req: Request, res: Response) => {
  try {
    console.log(`[Backend] Clearing Cluster Cache → ${GPU_SERVICE_URL}/api/cluster/cache`);

    const gpuResponse = await gpuClient.clearCache();
    console.log(`[Backend] Cache Clear response (${gpuResponse.status}): ${JSON.stringify(gpuResponse.data)}`);

    return res.status(gpuResponse.status).json(gpuResponse.data);
  } catch (err: any) {
    console.error('[Backend] deleteClusterCache error:', err);
    if (String(err?.message || '').includes('non-JSON')) {
      return res.status(502).json({ error: err.message });
    }
    return res.status(500).json({
      error: err.message || 'Failed to clear cluster cache',
    });
  }
};

/**
 * POST /api/cluster/visualize
 *
 * Forward dataset to GPU Service for Elbow & K-Distance computation.
 * Uses SentenceTransformer embeddings + DBSCAN noise filtering + K-Means on Colab.
 *
 * Request body: { data: Array, max_k?: number }
 * Response:     { elbow: [{k, wcss}], kDistance: [{rank, distance}], pointCount, noiseCount }
 */
export const clusterVisualize = async (req: Request, res: Response) => {
  try {
    const { data, max_k = 20, eps = 0.15, min_samples = 6 } = req.body;

    if (!data || !Array.isArray(data) || data.length === 0) {
      return res.status(400).json({ error: 'Missing or empty data array' });
    }

    console.log(
      `[Backend] Visualize ${data.length} items (max_k=${max_k}, eps=${eps}, min_samples=${min_samples}) → ${GPU_SERVICE_URL}/api/cluster/visualize`
    );

    const gpuResponse = await gpuClient.visualize({ data, max_k, eps, min_samples });
    console.log(
      `[Backend] Visualize response (${gpuResponse.status}): ${JSON.stringify(gpuResponse.data).slice(0, 300)}`
    );

    return res.status(gpuResponse.status).json(gpuResponse.data);
  } catch (err: any) {
    console.error('[Backend] clusterVisualize error:', err);
    if (String(err?.message || '').includes('non-JSON')) {
      return res.status(502).json({ error: err.message });
    }
    return res.status(500).json({
      error: err.message || 'Failed to compute visualization data',
    });
  }
};
