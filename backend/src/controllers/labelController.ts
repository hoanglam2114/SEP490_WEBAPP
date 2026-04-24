import { Request, Response } from 'express';
import mongoose from 'mongoose';
import { Label } from '../models/Label';
import { ProcessedDatasetItem } from '../models/ProcessedDatasetItem';
import { DatasetVersion } from '../models/DatasetVersion';

const HARD_LABELS = ['REJECT', 'ERROR_FORMULAR', 'USER_SPAM', 'ERROR_RESPONSE', 'ERROR_FORMAT'];

function getCurrentUserId(req: Request): string | null {
  const user = (req as any).user;
  return user?.id || user?.userId || user?._id || null;
}

function isCommunityHubRequest(req: Request): boolean {
  return String(req.query.fromCommunityHub || '').toLowerCase() === 'true';
}

async function getSampleOwnerIdBySampleId(sampleId: string): Promise<string | null> {
  const sample = await ProcessedDatasetItem.findById(sampleId).select('datasetVersionId').lean();
  if (!sample?.datasetVersionId) {
    return null;
  }

  const version = await DatasetVersion.findById(sample.datasetVersionId).select('ownerId').lean();
  if (!version?.ownerId) {
    return null;
  }

  return String(version.ownerId);
}

async function getSampleOwnerIdByLabelId(labelId: string): Promise<string | null> {
  const label = await Label.findById(labelId).select('sampleId').lean();
  if (!label?.sampleId) {
    return null;
  }

  return getSampleOwnerIdBySampleId(String(label.sampleId));
}

/** Shape each label document into the client-facing DTO. */
function formatLabel(label: any, userId: string) {
  const upvotes: string[] = (label.upvotes || []).map(String);
  const downvotes: string[] = (label.downvotes || []).map(String);

  const upvoteCount = upvotes.length;
  const downvoteCount = downvotes.length;
  const score = upvoteCount - downvoteCount;

  const hasUpvoted = upvotes.includes(String(userId));
  const hasDownvoted = downvotes.includes(String(userId));
  const hasVoted = hasUpvoted || hasDownvoted;
  const userVoteType: 'up' | 'down' | null = hasUpvoted ? 'up' : hasDownvoted ? 'down' : null;

  return {
    _id: label._id,
    sampleId: label.sampleId,
    name: label.name,
    type: label.type,
    createdBy: label.createdBy,
    createdAt: label.createdAt,
    updatedAt: label.updatedAt,
    upvotes,
    downvotes,
    upvoteCount,
    downvoteCount,
    score,
    hasVoted,
    userVoteType,
  };
}

// ─── GET /labels/:sampleId ────────────────────────────────────────────────────

export const getLabelsBySample = async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = getCurrentUserId(req);
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { sampleId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(sampleId)) {
      res.status(400).json({ error: 'Invalid sampleId' });
      return;
    }

    const labels = await Label.find({ sampleId: new mongoose.Types.ObjectId(sampleId) })
      .sort({ createdAt: -1 })
      .lean();

    const result = labels.map((label) => formatLabel(label, userId));

    res.status(200).json({ labels: result });
  } catch (error: any) {
    console.error('getLabelsBySample error:', error);
    res.status(500).json({ error: error.message || 'Failed to get labels' });
  }
};

// ─── POST /labels/:sampleId/add ──────────────────────────────────────────────

export const addLabel = async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = getCurrentUserId(req);
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { sampleId } = req.params;
    const { name, type } = req.body as { name?: string; type?: 'hard' | 'soft' };

    if (!mongoose.Types.ObjectId.isValid(sampleId)) {
      res.status(400).json({ error: 'Invalid sampleId' });
      return;
    }

    if (!name || !String(name).trim()) {
      res.status(400).json({ error: 'name is required' });
      return;
    }

    if (!type || !(['hard', 'soft'] as const).includes(type)) {
      res.status(400).json({ error: "type must be 'hard' or 'soft'" });
      return;
    }

    if (isCommunityHubRequest(req)) {
      const sampleOwnerId = await getSampleOwnerIdBySampleId(sampleId);
      if (sampleOwnerId && sampleOwnerId === String(userId)) {
        res.status(403).json({ error: 'Owner cannot add labels from Community Hub route.' });
        return;
      }
    }

    let normalizedName = String(name).trim();

    if (type === 'hard') {
      normalizedName = normalizedName.toUpperCase();
      if (!HARD_LABELS.includes(normalizedName)) {
        res.status(400).json({
          error: `Invalid hard label. Allowed values: ${HARD_LABELS.join(', ')}`,
        });
        return;
      }
    } else {
      normalizedName = normalizedName.toLowerCase();
    }

    const created = await Label.create({
      sampleId: new mongoose.Types.ObjectId(sampleId),
      name: normalizedName,
      type,
      createdBy: new mongoose.Types.ObjectId(userId),
      upvotes: [],
      downvotes: [],
    });

    res.status(201).json({ label: formatLabel(created.toObject(), userId) });
  } catch (error: any) {
    console.error('addLabel error:', error);
    res.status(500).json({ error: error.message || 'Failed to create label' });
  }
};

// ─── POST /labels/:labelId/vote ───────────────────────────────────────────────
//
// Body: { voteAction: 'up' | 'down' }
//
// Toggle logic:
//   - 'up':   if already upvoted → undo (remove from upvotes).
//             otherwise → add to upvotes, remove from downvotes.
//   - 'down': if already downvoted → undo (remove from downvotes).
//             otherwise → add to downvotes, remove from upvotes.
//
// Hard-label constraint: 'down' votes are NOT allowed on hard labels.

export const voteLabel = async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = getCurrentUserId(req);
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { labelId } = req.params;

    // Support both 'voteAction' (new field) and legacy 'voteType' for back-compat.
    const rawAction = req.body?.voteAction ?? req.body?.voteType;
    const voteAction = rawAction as 'up' | 'down' | undefined;

    if (!mongoose.Types.ObjectId.isValid(labelId)) {
      res.status(400).json({ error: 'Invalid labelId' });
      return;
    }

    if (!voteAction || !(['up', 'down'] as const).includes(voteAction)) {
      res.status(400).json({ error: "voteAction must be 'up' or 'down'" });
      return;
    }

    if (isCommunityHubRequest(req)) {
      const sampleOwnerId = await getSampleOwnerIdByLabelId(labelId);
      if (sampleOwnerId && sampleOwnerId === String(userId)) {
        res.status(403).json({ error: 'Owner cannot vote labels from Community Hub route.' });
        return;
      }
    }

    const label = await Label.findById(labelId);
    if (!label) {
      res.status(404).json({ error: 'Label not found' });
      return;
    }

    // Hard labels only accept upvotes.
    if (label.type === 'hard' && voteAction === 'down') {
      res.status(400).json({
        error: `Hard labels (e.g. ${label.name}) only support upvotes. Downvoting is not allowed.`,
      });
      return;
    }

    const userOid = new mongoose.Types.ObjectId(userId);

    const isInUpvotes = label.upvotes.some((id) => id.equals(userOid));
    const isInDownvotes = label.downvotes.some((id) => id.equals(userOid));

    if (voteAction === 'up') {
      if (isInUpvotes) {
        // Undo upvote.
        label.upvotes = label.upvotes.filter((id) => !id.equals(userOid));
      } else {
        // Cast upvote, remove any prior downvote.
        label.upvotes.push(userOid);
        label.downvotes = label.downvotes.filter((id) => !id.equals(userOid));
      }
    } else {
      // voteAction === 'down'
      if (isInDownvotes) {
        // Undo downvote.
        label.downvotes = label.downvotes.filter((id) => !id.equals(userOid));
      } else {
        // Cast downvote, remove any prior upvote.
        label.downvotes.push(userOid);
        label.upvotes = label.upvotes.filter((id) => !id.equals(userOid));
      }
    }

    await label.save();

    const dto = formatLabel(label.toObject(), userId);

    res.status(200).json({
      label: dto,
      upvoteCount: dto.upvoteCount,
      downvoteCount: dto.downvoteCount,
      score: dto.score,
      hasVoted: dto.hasVoted,
      userVoteType: dto.userVoteType,
    });
  } catch (error: any) {
    console.error('voteLabel error:', error);
    res.status(500).json({ error: error.message || 'Failed to vote label' });
  }
};
