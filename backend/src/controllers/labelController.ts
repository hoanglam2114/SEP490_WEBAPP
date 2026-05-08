import { Request, Response } from 'express';
import mongoose from 'mongoose';
import { Label } from '../models/Label';
import { ProcessedDatasetItem } from '../models/ProcessedDatasetItem';
import { DatasetVersion } from '../models/DatasetVersion';
import { DatasetSampleAssignment } from '../models/DatasetSampleAssignment';
import { DatasetAssignmentSubmission } from '../models/DatasetAssignmentSubmission';

const HARD_LABELS = [
  'REJECT',
  'MATH',
  'PHYSICAL',
  'CHEMISTRY',
  'LITERATURE',
  'BIOLOGY',
  'OUT_OF_SCOPE',
  'CORRECT',
  'INCORRECT',
  'REQUEST_HINT',
  'ASK_THEORY',
  'REQUEST_EXPLANATION',
  'REQUEST_SIMPLER',
  'SKIP_EXERCISE',
  'ENCOURAGE',
  'OFF_TOPIC',
  'NEXT_SECTION',
  'WAIT_READY',
  'PRAISING',
  'SCAFFOLDING',
  'HINTING',
  'CONCEPT_CLARIFY',
  'LOGIC_BREAKDOWN',
  'SIMPLIFYING',
  'NAVIGATING',
  'MOTIVATING',
  'REDIRECTING',
  'TRANSITIONING',
  'WAITING',
];
const LABEL_SCOPES = ['sample', 'message'] as const;
const LABEL_QUERY_SCOPES = ['sample', 'message', 'all'] as const;
const MESSAGE_ROLES = ['user', 'assistant'] as const;

type SampleAccess = {
  datasetVersionId: string;
  ownerId: string;
  isPublic: boolean;
  hasAssignments: boolean;
  isAssignedToUser: (userId: string) => Promise<boolean>;
  isAssignedSample: () => Promise<boolean>;
};

function getCurrentUserId(req: Request): string | null {
  const user = (req as any).user;
  return user?.id || user?.userId || user?._id || null;
}

function isCommunityHubRequest(req: Request): boolean {
  return String(req.query.fromCommunityHub || '').toLowerCase() === 'true';
}

function sampleScopeQuery(): Record<string, any> {
  return {
    $or: [
      { targetScope: 'sample' },
      { targetScope: { $exists: false } },
      { targetScope: null },
    ],
  };
}

function normalizeTargetScope(value: unknown): 'sample' | 'message' {
  return value === 'message' ? 'message' : 'sample';
}

function normalizeQueryScope(value: unknown): 'sample' | 'message' | 'all' {
  return LABEL_QUERY_SCOPES.includes(value as any) ? value as 'sample' | 'message' | 'all' : 'sample';
}

async function getSampleAccessBySampleId(
  sampleId: string
): Promise<SampleAccess | null> {
  const sample = await ProcessedDatasetItem.findById(sampleId).select('datasetVersionId').lean();
  if (!sample?.datasetVersionId) {
    return null;
  }

  const version = await DatasetVersion.findById(sample.datasetVersionId)
    .select('ownerId isPublic')
    .lean();
  if (!version?.ownerId) {
    return null;
  }

  const assignmentCount = await DatasetSampleAssignment.countDocuments({ datasetVersionId: sample.datasetVersionId });

  return {
    datasetVersionId: String(sample.datasetVersionId),
    ownerId: String(version.ownerId),
    isPublic: Boolean((version as any).isPublic),
    hasAssignments: assignmentCount > 0,
    isAssignedToUser: async (userId: string) => Boolean(await DatasetSampleAssignment.exists({
      datasetVersionId: sample.datasetVersionId,
      sampleId: new mongoose.Types.ObjectId(sampleId),
      assigneeId: new mongoose.Types.ObjectId(userId),
    })),
    isAssignedSample: async () => Boolean(await DatasetSampleAssignment.exists({
      datasetVersionId: sample.datasetVersionId,
      sampleId: new mongoose.Types.ObjectId(sampleId),
    })),
  };
}

async function getSampleAccessByLabelId(
  labelId: string
): Promise<SampleAccess | null> {
  const label = await Label.findById(labelId).select('sampleId').lean();
  if (!label?.sampleId) {
    return null;
  }

  return getSampleAccessBySampleId(String(label.sampleId));
}

async function assertLabelAccessBySampleId(sampleId: string, userId: string, req: Request): Promise<void> {
  const access = await getSampleAccessBySampleId(sampleId);
  if (!access) {
    const error = new Error('Sample not found');
    (error as any).statusCode = 404;
    throw error;
  }

  const isOwner = access.ownerId === String(userId);
  const hasAssignedAccess = await access.isAssignedToUser(userId);
  const lockedSubmission = !isOwner && hasAssignedAccess
    ? await DatasetAssignmentSubmission.findOne({
        datasetVersionId: new mongoose.Types.ObjectId(access.datasetVersionId),
        assigneeId: new mongoose.Types.ObjectId(userId),
        status: { $in: ['submitted', 'approved'] },
      }).select('status').lean()
    : null;
  if (isCommunityHubRequest(req)) {
    if (!isOwner && !access.isPublic && !hasAssignedAccess) {
      const error = new Error('Dataset version is not public and this account is not assigned.');
      (error as any).statusCode = 403;
      throw error;
    }
    if (!isOwner && access.hasAssignments && !hasAssignedAccess) {
      const error = new Error('Sample is not assigned to this account.');
      (error as any).statusCode = 403;
      throw error;
    }
    if (lockedSubmission) {
      const error = new Error(`Assignment submission is ${lockedSubmission.status}; labels are locked.`);
      (error as any).statusCode = 403;
      throw error;
    }
    if (isOwner) {
      return;
    }
    return;
  }

  if (!isOwner) {
    const error = new Error('Forbidden: only the dataset owner can label from the internal workflow.');
    (error as any).statusCode = 403;
    throw error;
  }
}

async function getSampleAccessForRead(sampleId: string, userId: string): Promise<SampleAccess> {
  const access = await getSampleAccessBySampleId(sampleId);
  if (!access) {
    const error = new Error('Sample not found');
    (error as any).statusCode = 404;
    throw error;
  }

  const isOwner = access.ownerId === String(userId);
  const hasAssignedAccess = await access.isAssignedToUser(userId);
  if (!isOwner && !access.isPublic && !hasAssignedAccess) {
    const error = new Error('Forbidden: you do not have access to this sample labels.');
    (error as any).statusCode = 403;
    throw error;
  }
  if (!isOwner && access.hasAssignments && !hasAssignedAccess) {
    const error = new Error('Sample is not assigned to this account.');
    (error as any).statusCode = 403;
    throw error;
  }

  return access;
}

async function assertLabelAccessByLabelId(labelId: string, userId: string, req: Request): Promise<void> {
  const access = await getSampleAccessByLabelId(labelId);
  if (!access) {
    const error = new Error('Label not found');
    (error as any).statusCode = 404;
    throw error;
  }

  const isOwner = access.ownerId === String(userId);
  const hasAssignedAccess = await access.isAssignedToUser(userId);
  const lockedSubmission = !isOwner && hasAssignedAccess
    ? await DatasetAssignmentSubmission.findOne({
        datasetVersionId: new mongoose.Types.ObjectId(access.datasetVersionId),
        assigneeId: new mongoose.Types.ObjectId(userId),
        status: { $in: ['submitted', 'approved'] },
      }).select('status').lean()
    : null;
  if (isCommunityHubRequest(req)) {
    if (!isOwner && !access.isPublic && !hasAssignedAccess) {
      const error = new Error('Dataset version is not public and this account is not assigned.');
      (error as any).statusCode = 403;
      throw error;
    }
    if (!isOwner && access.hasAssignments && !hasAssignedAccess) {
      const error = new Error('Sample is not assigned to this account.');
      (error as any).statusCode = 403;
      throw error;
    }
    if (lockedSubmission) {
      const error = new Error(`Assignment submission is ${lockedSubmission.status}; labels are locked.`);
      (error as any).statusCode = 403;
      throw error;
    }
    if (isOwner) {
      return;
    }
    return;
  }

  if (!isOwner) {
    const error = new Error('Forbidden: only the dataset owner can vote from the internal workflow.');
    (error as any).statusCode = 403;
    throw error;
  }
}

/** Shape each label document into the client-facing DTO. */
function formatLabel(label: any, userId: string) {
  const upvotes: string[] = (label.upvotes || []).map(String);
  const downvotes: string[] = (label.downvotes || []).map(String);

  const upvoteCount = upvotes.length;
  const downvoteCount = downvotes.length;
  const score = upvoteCount - downvoteCount;


/** Shape each label document into the client-facing DTO. */

  const hasUpvoted = upvotes.includes(String(userId));
  const hasDownvoted = downvotes.includes(String(userId));
  const hasVoted = hasUpvoted || hasDownvoted;
  const userVoteType: 'up' | 'down' | null = hasUpvoted ? 'up' : hasDownvoted ? 'down' : null;

  const creator = label.createdBy && typeof label.createdBy === 'object'
    ? {
        id: String(label.createdBy._id || label.createdBy.id || ''),
        name: String(label.createdBy.name || ''),
        email: String(label.createdBy.email || ''),
      }
    : { id: String(label.createdBy || '') };

  return {
    _id: label._id,
    sampleId: label.sampleId,
    name: label.name,
    type: label.type,
    targetScope: label.targetScope || 'sample',
    messageIndex: label.messageIndex,
    messageRole: label.messageRole,
    targetTextSnapshot: label.targetTextSnapshot,
    creator,
    createdBy: creator.id,
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

function hasAnyVotes(label: any): boolean {
  const upvoteCount = Array.isArray(label?.upvotes) ? label.upvotes.length : 0;
  const downvoteCount = Array.isArray(label?.downvotes) ? label.downvotes.length : 0;
  return upvoteCount > 0 || downvoteCount > 0;
}

function buildHardLabelLookupQuery(
  sampleId: string,
  targetScope: 'sample' | 'message',
  normalizedName: string,
  messageIndex?: number,
  messageRole?: 'user' | 'assistant'
): Record<string, any> {
  const query: Record<string, any> = {
    sampleId: new mongoose.Types.ObjectId(sampleId),
    type: 'hard',
    name: normalizedName,
  };

  if (targetScope === 'sample') {
    Object.assign(query, sampleScopeQuery());
    return query;
  }

  query.targetScope = 'message';
  query.messageIndex = messageIndex;
  query.messageRole = messageRole;
  return query;
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

    const access = await getSampleAccessForRead(sampleId, userId);
    const isOwner = access.ownerId === String(userId);

    const scope = normalizeQueryScope(req.query.scope);
    const includeUnvoted = String(req.query.includeUnvoted || '').toLowerCase() === 'true';
    const createdBy = String(req.query.createdBy || '').trim();
    const contributedBy = String(req.query.contributedBy || '').trim();
    const query: Record<string, any> = {
      sampleId: new mongoose.Types.ObjectId(sampleId),
    };

    if (scope === 'sample') {
      Object.assign(query, sampleScopeQuery());
    } else if (scope === 'message') {
      query.targetScope = 'message';
      const rawMessageIndex = req.query.messageIndex;
      if (rawMessageIndex !== undefined) {
        const messageIndex = Number(rawMessageIndex);
        if (!Number.isInteger(messageIndex) || messageIndex < 0) {
          res.status(400).json({ error: 'messageIndex must be a non-negative integer' });
          return;
        }
        query.messageIndex = messageIndex;
      }
    }

    if (createdBy) {
      if (!mongoose.Types.ObjectId.isValid(createdBy)) {
        res.status(400).json({ error: 'Invalid createdBy' });
        return;
      }
      if (!isOwner && createdBy !== String(userId)) {
        res.status(403).json({ error: 'Forbidden: cannot filter labels by another user.' });
        return;
      }
      query.createdBy = new mongoose.Types.ObjectId(createdBy);
    }

    if (contributedBy) {
      if (!mongoose.Types.ObjectId.isValid(contributedBy)) {
        res.status(400).json({ error: 'Invalid contributedBy' });
        return;
      }
      if (!isOwner && contributedBy !== String(userId)) {
        res.status(403).json({ error: 'Forbidden: cannot filter labels by another user contribution.' });
        return;
      }
      const contributorOid = new mongoose.Types.ObjectId(contributedBy);
      query.$or = [
        { createdBy: contributorOid },
        { upvotes: contributorOid },
      ];
    }

    const labels = await Label.find(query)
      .populate('createdBy', 'name email')
      .sort({ createdAt: -1 })
      .lean();

    const canIncludeUnvoted = isOwner || createdBy === String(userId) || contributedBy === String(userId);
    const visibleLabels = includeUnvoted && canIncludeUnvoted
      ? labels
      : labels.filter((label) => hasAnyVotes(label));
    const result = visibleLabels.map((label) => formatLabel(label, userId));

    res.status(200).json({ labels: result });
  } catch (error: any) {
    console.error('getLabelsBySample error:', error);
    res.status(error.statusCode || 500).json({ error: error.message || 'Failed to get labels' });
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
    const { name, type, targetScope: rawTargetScope, messageIndex: rawMessageIndex, messageRole, targetTextSnapshot } = req.body as {
      name?: string;
      type?: 'hard' | 'soft';
      targetScope?: 'sample' | 'message';
      messageIndex?: number;
      messageRole?: 'user' | 'assistant';
      targetTextSnapshot?: string;
    };

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

    await assertLabelAccessBySampleId(sampleId, userId, req);

    const targetScope = normalizeTargetScope(rawTargetScope);
    let messageIndex: number | undefined;
    let normalizedMessageRole: 'user' | 'assistant' | undefined;
    let normalizedTargetTextSnapshot: string | undefined;

    if (!LABEL_SCOPES.includes(targetScope)) {
      res.status(400).json({ error: "targetScope must be 'sample' or 'message'" });
      return;
    }

    if (targetScope === 'message') {
      messageIndex = Number(rawMessageIndex);
      if (!Number.isInteger(messageIndex) || messageIndex < 0) {
        res.status(400).json({ error: 'messageIndex must be a non-negative integer for message labels' });
        return;
      }

      if (!MESSAGE_ROLES.includes(messageRole as any)) {
        res.status(400).json({ error: "messageRole must be 'user' or 'assistant' for message labels" });
        return;
      }

      normalizedMessageRole = messageRole as 'user' | 'assistant';
      const text = String(targetTextSnapshot || '').trim();
      normalizedTargetTextSnapshot = text ? text.slice(0, 2000) : undefined;
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

    const userOid = new mongoose.Types.ObjectId(userId);
    if (type === 'hard') {
      const existing = await Label.findOne(
        buildHardLabelLookupQuery(sampleId, targetScope, normalizedName, messageIndex, normalizedMessageRole)
      ).sort({ createdAt: 1 });

      if (existing) {
        const alreadyUpvoted = existing.upvotes.some((id) => id.equals(userOid));
        if (!alreadyUpvoted) {
          existing.upvotes.push(userOid);
        }
        existing.downvotes = existing.downvotes.filter((id) => !id.equals(userOid));
        await existing.save();

        const populatedExisting = await Label.findById(existing._id)
          .populate('createdBy', 'name email')
          .lean();
        res.status(200).json({ label: formatLabel(populatedExisting, userId) });
        return;
      }
    }

    const created = await Label.create({
      sampleId: new mongoose.Types.ObjectId(sampleId),
      name: normalizedName,
      type,
      targetScope,
      messageIndex,
      messageRole: normalizedMessageRole,
      targetTextSnapshot: normalizedTargetTextSnapshot,
      createdBy: userOid,
      upvotes: type === 'hard' ? [userOid] : (isCommunityHubRequest(req) ? [] : [userOid]),
      downvotes: [],
    });

    const populated = await Label.findById(created._id)
      .populate('createdBy', 'name email')
      .lean();

    res.status(201).json({ label: formatLabel(populated, userId) });

  } catch (error: any) {
    console.error('addLabel error:', error);
    res.status(error.statusCode || 500).json({ error: error.message || 'Failed to create label' });
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
// Hard-label constraint: 'down' votes are now allowed on hard labels.

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

    await assertLabelAccessByLabelId(labelId, userId, req);

    const label = await Label.findById(labelId);
    if (!label) {
      res.status(404).json({ error: 'Label not found' });
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

    const hasVotesAfterToggle = label.upvotes.length > 0 || label.downvotes.length > 0;
    if (!hasVotesAfterToggle) {
      await Label.deleteOne({ _id: label._id });
      res.status(200).json({
        label: null,
        deleted: true,
        deletedLabelId: String(label._id),
        upvoteCount: 0,
        downvoteCount: 0,
        score: 0,
        hasVoted: false,
        userVoteType: null,
      });
      return;
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
    res.status(error.statusCode || 500).json({ error: error.message || 'Failed to vote label' });
  }
};
