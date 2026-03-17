import { Request, Response } from 'express';
import { HuggingFaceService } from '../services/huggingfaceService';

const huggingfaceService = new HuggingFaceService();

export class HuggingFaceController {
    /**
     * Upload dataset content from the client directly to Hugging Face
     */
    async uploadDataset(req: Request, res: Response): Promise<void> {
        try {
            const { token, repoId, fileName, content, isPrivate } = req.body;

            if (!token || !repoId || !content || !fileName) {
                res.status(400).json({ error: 'Missing required fields (token, repoId, fileName, content)' });
                return;
            }

            const result = await huggingfaceService.uploadDataset(
                token,
                repoId,
                content,
                fileName,
                isPrivate ?? true
            );

            res.status(200).json({
                message: 'Successfully uploaded to Hugging Face Hub',
                url: result.url,
            });
        } catch (error: any) {
            console.error('Hugging Face Upload Error:', error);
            res.status(500).json({
                error: 'Failed to upload to Hugging Face',
                details: error.message,
            });
        }
    }
}
