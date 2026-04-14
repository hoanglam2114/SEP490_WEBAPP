import { Request, Response } from 'express';
import fetch from 'node-fetch';
import dotenv from 'dotenv';
dotenv.config();

const GPU_SERVICE_URL = process.env.GPU_SERVICE_URL || 'http://localhost:5000';

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
    console.log(`[Backend] Clustering ${data.length} conversations → ${GPU_SERVICE_URL}/api/cluster`);

    const gpuResponse = await fetch(`${GPU_SERVICE_URL}/api/cluster`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'ngrok-skip-browser-warning': 'true',
      },
      body: JSON.stringify({ data }),
    });

    const responseText = await gpuResponse.text();
    console.log(`[Backend] Cluster response (${gpuResponse.status}): ${responseText.slice(0, 300)}`);

    let result: any;
    try {
      result = JSON.parse(responseText);
    } catch {
      return res.status(502).json({
        error: 'Cluster service returned non-JSON response',
        raw: responseText.slice(0, 500),
      });
    }

    return res.status(gpuResponse.status).json(result);
  } catch (err: any) {
    console.error('[Backend] clusterData error:', err);
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

    const gpuResponse = await fetch(`${GPU_SERVICE_URL}/api/cluster/filter`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'ngrok-skip-browser-warning': 'true',
      },
      body: JSON.stringify({ data, threshold }),
    });

    const responseText = await gpuResponse.text();
    console.log(`[Backend] Filter response (${gpuResponse.status}): ${responseText.slice(0, 300)}`);

    let result: any;
    try {
      result = JSON.parse(responseText);
    } catch {
      return res.status(502).json({
        error: 'Cluster filter service returned non-JSON response',
        raw: responseText.slice(0, 500),
      });
    }

    return res.status(gpuResponse.status).json(result);
  } catch (err: any) {
    console.error('[Backend] clusterFilter error:', err);
    return res.status(500).json({
      error: err.message || 'Failed to filter cluster data',
    });
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

    const gpuResponse = await fetch(`${GPU_SERVICE_URL}/api/cluster/cache`, {
      method: 'DELETE',
      headers: {
        'ngrok-skip-browser-warning': 'true',
      },
    });

    const responseText = await gpuResponse.text();
    console.log(`[Backend] Cache Clear response (${gpuResponse.status}): ${responseText}`);

    let result: any;
    try {
      result = JSON.parse(responseText);
    } catch {
      result = { message: responseText };
    }

    return res.status(gpuResponse.status).json(result);
  } catch (err: any) {
    console.error('[Backend] deleteClusterCache error:', err);
    return res.status(500).json({
      error: err.message || 'Failed to clear cluster cache',
    });
  }
};
