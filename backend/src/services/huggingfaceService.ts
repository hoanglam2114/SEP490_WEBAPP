import { createRepo, uploadFiles } from '@huggingface/hub';

export class HuggingFaceService {
    /**
     * Upload a dataset to Hugging Face Hub
     * @param token Hugging Face User Access Token
     * @param repoId The targeted repository ID, e.g. "username/my-dataset"
     * @param content The dataset content (JSON/JSONL string)
     * @param fileName The name of the file
     * @param isPrivate Whether the dataset should be private
     */
    async uploadDataset(
        token: string,
        repoId: string,
        content: string,
        fileName: string,
        isPrivate: boolean = true
    ): Promise<{ url: string }> {
        try {
            if (!token) {
                throw new Error('Hugging Face Token is missing.');
            }
            if (!repoId) {
                throw new Error('Repository ID is missing.');
            }

            // Ensure the repository exists
            try {
                await createRepo({
                    credentials: { accessToken: token },
                    repo: { name: repoId, type: 'dataset' },
                    private: isPrivate,
                });
            } catch (error: any) {
                // If repo already exists, `createRepo` throws a 409 Conflict.
                // We can safely ignore it and proceed to upload.
                if (error?.statusCode !== 409 && !error?.message?.includes('already exists')) {
                    throw error;
                }
            }

            // Upload the file
            const fileBlob = new Blob([content], { type: 'text/plain' });

            await uploadFiles({
                credentials: { accessToken: token },
                repo: { name: repoId, type: 'dataset' },
                files: [
                    {
                        path: fileName,
                        content: fileBlob,
                    },
                ],
                commitTitle: `Add dataset ${fileName}`,
            });

            return {
                url: `https://huggingface.co/datasets/${repoId}`,
            };
        } catch (error: any) {
            console.error('HuggingFace Service Error:', error);
            throw new Error(error.message || 'Failed to upload dataset to Hugging Face');
        }
    }
}
