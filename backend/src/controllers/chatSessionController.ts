import { Request, Response } from 'express';
import { ChatSession } from '../models/ChatSession';
import { getAuthUserId } from '../utils/auth';

// Get all sessions (sorted by recent)
export const getSessions = async (req: Request, res: Response): Promise<void> => {
  try {
    const ownerId = getAuthUserId(req);
    if (!ownerId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const limit = parseInt(req.query.limit as string) || 30;
    const sessions = await ChatSession.find({ ownerId }, { messages: 0 }) // Exclude messages for list view to save bandwidth
      .sort({ updatedAt: -1 })
      .limit(limit);
      
    res.json(sessions);
  } catch (error: any) {
    console.error('Get Sessions Error:', error);
    res.status(500).json({ error: 'Failed to fetch sessions', details: error.message });
  }
};

// Get a specific session by ID
export const getSessionById = async (req: Request, res: Response): Promise<void> => {
  try {
    const ownerId = getAuthUserId(req);
    if (!ownerId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const session = await ChatSession.findOne({ _id: req.params.id, ownerId });
    if (!session) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }
    res.json(session);
  } catch (error: any) {
    console.error('Get Session Error:', error);
    res.status(500).json({ error: 'Failed to fetch session', details: error.message });
  }
};

// Create a new session with an initial message pair
export const createSession = async (req: Request, res: Response): Promise<void> => {
  try {
    const ownerId = getAuthUserId(req);
    if (!ownerId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { userMessage, aiMessage, model, responseTime } = req.body;

    if (!userMessage || !aiMessage) {
      res.status(400).json({ error: 'Missing required messages' });
      return;
    }

    // Auto-generate title from the first user message (up to 40 chars)
    let title = userMessage.trim().split('\n')[0];
    if (title.length > 40) {
      title = title.substring(0, 40) + '...';
    }

    const newSession = new ChatSession({
      ownerId,
      title,
      messages: [
        { role: 'user', content: userMessage, createdAt: new Date() },
        { role: 'ai', content: aiMessage, model, responseTime, createdAt: new Date() }
      ]
    });

    await newSession.save();
    res.status(201).json(newSession);
  } catch (error: any) {
    console.error('Create Session Error:', error);
    res.status(500).json({ error: 'Failed to create session', details: error.message });
  }
};

// Append a new message pair to an existing session
export const appendMessageToSession = async (req: Request, res: Response): Promise<void> => {
  try {
    const ownerId = getAuthUserId(req);
    if (!ownerId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { id } = req.params;
    const { userMessage, aiMessage, model, responseTime } = req.body;

    if (!userMessage || !aiMessage) {
      res.status(400).json({ error: 'Missing required messages' });
      return;
    }

    const session = await ChatSession.findOne({ _id: id, ownerId });
    if (!session) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }

    session.messages.push({ role: 'user', content: userMessage, createdAt: new Date() });
    session.messages.push({ role: 'ai', content: aiMessage, model, responseTime, createdAt: new Date() });
    session.updatedAt = new Date();
    
    await session.save();
    res.json(session);
  } catch (error: any) {
    console.error('Append Message Error:', error);
    res.status(500).json({ error: 'Failed to append message', details: error.message });
  }
};

// Delete a session
export const deleteSession = async (req: Request, res: Response): Promise<void> => {
  try {
    const ownerId = getAuthUserId(req);
    if (!ownerId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { id } = req.params;
    const deletedSession = await ChatSession.findOneAndDelete({ _id: id, ownerId });
    if (!deletedSession) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }
    res.json({ message: 'Session deleted successfully' });
  } catch (error: any) {
    console.error('Delete Session Error:', error);
    res.status(500).json({ error: 'Failed to delete session', details: error.message });
  }
};
