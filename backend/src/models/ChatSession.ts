import mongoose, { Schema, Document } from 'mongoose';

export interface IMessage {
    role: "user" | "ai";
    content: string;
    model?: string;
    responseTime?: number;
    createdAt?: Date;
}

export interface IChatSession extends Document {
    ownerId: mongoose.Types.ObjectId;
    title: string;
    messages: IMessage[];
    createdAt: Date;
    updatedAt: Date;
}

const messageSchema = new Schema<IMessage>({
    role: { type: String, enum: ["user", "ai"], required: true },
    content: { type: String, required: true },
    model: { type: String },
    responseTime: { type: Number },
    createdAt: { type: Date, default: Date.now }
}, { _id: false });

const chatSessionSchema = new Schema<IChatSession>({
    ownerId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    title: { type: String, required: true },
    messages: [messageSchema],
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now }
});

export const ChatSession = mongoose.model<IChatSession>('ChatSession', chatSessionSchema);
