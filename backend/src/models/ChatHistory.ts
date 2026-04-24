import mongoose, { Schema } from 'mongoose';

export interface IChatHistory {
    ownerId: mongoose.Types.ObjectId;
    userMessage: string;
    aiMessage: string;
    model: string;
    responseTime: number;
    createdAt: Date;
}

const chatHistorySchema = new Schema<IChatHistory>({
    ownerId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    userMessage: { type: String, required: true },
    aiMessage: { type: String, required: true },
    model: { type: String, required: true },
    responseTime: { type: Number, required: true },
    createdAt: { type: Date, default: Date.now },
});

export const ChatHistory = mongoose.model<IChatHistory>('ChatHistory', chatHistorySchema);
