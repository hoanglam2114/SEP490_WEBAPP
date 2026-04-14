import React, { useState } from 'react';
import { UploadCloud, Loader2 } from 'lucide-react';
import { useMutation } from '@tanstack/react-query';
import { useAppStore } from '../hooks/useAppStore';
import { ConversionResult } from '../types';
import toast from 'react-hot-toast';

interface HuggingFaceUploadProps {
    conversionResult: ConversionResult;
}

export const HuggingFaceUpload: React.FC<HuggingFaceUploadProps> = ({ conversionResult }) => {
    const { uploadedFile } = useAppStore();
    const [token, setToken] = useState('');
    const [repoId, setRepoId] = useState('');
    const [isPrivate, setIsPrivate] = useState(true);

    const uploadMutation = useMutation({
        mutationFn: async () => {
            const { data, filename } = conversionResult;
            const isJsonl = filename.endsWith('.jsonl');

            // Strip metadata fields like 'cluster', 'groupId', etc. before uploading
            const cleanData = data.map(({ cluster, assignments, clusterLabel, groupId, ...rest }: any) => rest);

            // Regenerate output consistent with backend and download button
            let output: string;
            if (isJsonl) {
                output = cleanData.map((item: any) => JSON.stringify(item)).join('\n');
            } else {
                output = JSON.stringify(cleanData, null, 2);
            }

            // Upload to HF Hub
            const response = await fetch('/api/huggingface/upload', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    token,
                    repoId,
                    fileName: filename,
                    content: output,
                    isPrivate,
                }),
            });

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.error || 'Failed to upload to Hugging Face');
            }

            return response.json();
        },
        onSuccess: (data) => {
            toast.success('Successfully uploaded to Hugging Face Hub!');
            if (data.url) {
                window.open(data.url, '_blank', 'noopener,noreferrer');
            }
        },
        onError: (error: any) => {
            toast.error(error.message || 'Upload failed');
        },
    });

    if (!uploadedFile) {
        return null;
    }

    return (
        <div className="bg-white rounded-lg border border-gray-200 p-6 space-y-4">
            <div className="flex items-center space-x-2 mb-2">
                <span className="text-xl">🤗</span>
                <h3 className="font-semibold text-gray-900">Push to Hugging Face Hub</h3>
            </div>

            <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                    Hugging Face Token
                </label>
                <input
                    type="password"
                    value={token}
                    onChange={(e) => setToken(e.target.value)}
                    placeholder="hf_..."
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent text-sm"
                />

            </div>

            <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                    Repository ID
                </label>
                <input
                    type="text"
                    value={repoId}
                    onChange={(e) => setRepoId(e.target.value)}
                    placeholder="username/my-dataset"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent text-sm"
                />
            </div>

            <div>
                <label className="flex items-center space-x-2">
                    <input
                        type="checkbox"
                        checked={isPrivate}
                        onChange={(e) => setIsPrivate(e.target.checked)}
                        className="rounded text-primary-600 focus:ring-primary-500"
                    />
                    <span className="text-sm font-medium text-gray-700">
                        Make repository private
                    </span>
                </label>
            </div>

            <button
                onClick={() => uploadMutation.mutate()}
                disabled={uploadMutation.isPending || !token || !repoId}
                className="w-full mt-4 bg-orange-500 hover:bg-orange-600 disabled:bg-gray-300 text-white font-semibold py-3 px-4 rounded-lg transition-colors duration-200 flex items-center justify-center space-x-2"
            >
                {uploadMutation.isPending ? (
                    <>
                        <Loader2 className="w-5 h-5 animate-spin" />
                        <span>Pushing to Hub...</span>
                    </>
                ) : (
                    <>
                        <UploadCloud className="w-5 h-5" />
                        <span>Push to Hub</span>
                    </>
                )}
            </button>
        </div>
    );
};
