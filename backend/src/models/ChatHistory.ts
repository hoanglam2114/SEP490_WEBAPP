import mongoose, { Schema } from 'mongoose';

export interface IChatHistory {
    userMessage: string;
    aiMessage: string;
    model: string;
    responseTime: number;
    createdAt: Date;
}

const chatHistorySchema = new Schema<IChatHistory>({
    userMessage: { type: String, required: true },
    aiMessage: { type: String, required: true },
    model: { type: String, required: true },
    responseTime: { type: Number, required: true },
    createdAt: { type: Date, default: Date.now },
});

export const ChatHistory = mongoose.model<IChatHistory>('ChatHistory', chatHistorySchema);
