import { Request, Response } from 'express';
import mongoose from 'mongoose';
import { ProcessedDatasetItem } from '../models/ProcessedDatasetItem';
import { DatasetVersion } from '../models/DatasetVersion';
import { DatasetSampleAssignment } from '../models/DatasetSampleAssignment';
import { DatasetAssignmentSubmission } from '../models/DatasetAssignmentSubmission';
import {
  HARD_LABELS,
  assignLabelToSample,
  getAggregatedLabelsForSample,
  isSupportedHardLabel,
  normalizeQueryScope,
  normalizeTargetScope,
  unassignLabelFromSample,
} from '../services/labelAssignmentService';

const MESSAGE_ROLES = ['user', 'assistant'] as const;

type SampleAccess = {
  datasetVersionId: string;
  ownerId: string;
  isPublic: boolean;
  hasAssignments: boolean;
  isAssignedToUser: (userId: string) => Promise<boolean>;
};

function getCurrentUserId(req: Request): string | null {
  const user = (req as any).user;
  return user?.id || user?.userId || user?._id || null;
}

function isCommunityHubRequest(req: Request): boolean {
  return String(req.query.fromCommunityHub || '').toLowerCase() === 'true';
}

async function getSampleAccessBySampleId(sampleId: string): Promise<SampleAccess | null> {
  const sample = await ProcessedDatasetItem.findById(sampleId).select('datasetVersionId').lean();
  if (!sample?.datasetVersionId) {
    return null;
  }

  const version = await DatasetVersion.findById(sample.datasetVersionId).select('ownerId isPublic').lean();
  if (!version?.ownerId) {
    return null;
  }

  const assignmentCount = await DatasetSampleAssignment.countDocuments({ datasetVersionId: sample.datasetVersionId });
  return {
    datasetVersionId: String(sample.datasetVersionId),
    ownerId: String(version.ownerId),
    isPublic: Boolean((version as any).isPublic),
    hasAssignments: assignmentCount > 0,
    isAssignedToUser: async (userId: string) =>
      Boolean(
        await DatasetSampleAssignment.exists({
          datasetVersionId: sample.datasetVersionId,
          sampleId: new mongoose.Types.ObjectId(sampleId),
          assigneeId: new mongoose.Types.ObjectId(userId),
        })
      ),
  };
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

function validateTargetScopePayload(
  res: Response,
  rawTargetScope: unknown,
  rawMessageIndex: unknown,
  rawMessageRole: unknown
): { targetScope: 'sample' | 'message'; messageIndex?: number; messageRole?: 'user' | 'assistant' } | null {
  const targetScope = normalizeTargetScope(rawTargetScope);
  if (targetScope === 'sample') {
    return { targetScope };
  }

  const messageIndex = Number(rawMessageIndex);
  if (!Number.isInteger(messageIndex) || messageIndex < 0) {
    res.status(400).json({ error: 'messageIndex must be a non-negative integer for message labels' });
    return null;
  }

  if (!MESSAGE_ROLES.includes(rawMessageRole as any)) {
    res.status(400).json({ error: "messageRole must be 'user' or 'assistant' for message labels" });
    return null;
  }

  return {
    targetScope,
    messageIndex,
    messageRole: rawMessageRole as 'user' | 'assistant',
  };
}

function getErrorMessage(error: any, fallback: string) {
  return error?.message || fallback;
}

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
    const rawMessageIndex = req.query.messageIndex;
    let parsedMessageIndex: number | undefined;
    if (rawMessageIndex !== undefined) {
      const nextMessageIndex = Number(rawMessageIndex);
      if (!Number.isInteger(nextMessageIndex) || nextMessageIndex < 0) {
        res.status(400).json({ error: 'messageIndex must be a non-negative integer' });
        return;
      }
      parsedMessageIndex = nextMessageIndex;
    }

    const createdBy = String(req.query.createdBy || '').trim();
    const contributedBy = String(req.query.contributedBy || '').trim();
    if (createdBy && !mongoose.Types.ObjectId.isValid(createdBy)) {
      res.status(400).json({ error: 'Invalid createdBy' });
      return;
    }
    if (contributedBy && !mongoose.Types.ObjectId.isValid(contributedBy)) {
      res.status(400).json({ error: 'Invalid contributedBy' });
      return;
    }
    if (!isOwner && createdBy && createdBy !== userId) {
      res.status(403).json({ error: 'Forbidden: cannot filter labels by another user.' });
      return;
    }
    if (!isOwner && contributedBy && contributedBy !== userId) {
      res.status(403).json({ error: 'Forbidden: cannot filter labels by another user contribution.' });
      return;
    }

    const labels = await getAggregatedLabelsForSample(sampleId, userId, {
      scope,
      messageIndex: parsedMessageIndex,
      createdBy: createdBy || undefined,
      contributedBy: contributedBy || undefined,
      includeAssignedUsers: isOwner,
    });

    res.status(200).json({ labels });
  } catch (error: any) {
    console.error('getLabelsBySample error:', error);
    res.status(error.statusCode || 500).json({ error: getErrorMessage(error, 'Failed to get labels') });
  }
};

export const addLabel = async (req: Request, res: Response): Promise<void> => {
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

    const {
      name,
      type,
      targetScope: rawTargetScope,
      messageIndex: rawMessageIndex,
      messageRole: rawMessageRole,
      targetTextSnapshot,
    } = req.body as {
      name?: string;
      type?: 'hard' | 'soft';
      targetScope?: 'sample' | 'message';
      messageIndex?: number;
      messageRole?: 'user' | 'assistant';
      targetTextSnapshot?: string;
    };

    if (!name || !String(name).trim()) {
      res.status(400).json({ error: 'name is required' });
      return;
    }
    if (!type || !(['hard', 'soft'] as const).includes(type)) {
      res.status(400).json({ error: "type must be 'hard' or 'soft'" });
      return;
    }

    await assertLabelAccessBySampleId(sampleId, userId, req);

    const targetInfo = validateTargetScopePayload(res, rawTargetScope, rawMessageIndex, rawMessageRole);
    if (!targetInfo) {
      return;
    }

    const normalizedName = type === 'hard' ? String(name).trim().toUpperCase() : String(name).trim().toLowerCase();
    if (type === 'hard' && !isSupportedHardLabel(normalizedName)) {
      res.status(400).json({
        error: `Invalid hard label. Allowed values: ${HARD_LABELS.join(', ')}`,
      });
      return;
    }

    await assignLabelToSample({
      sampleId,
      userId,
      name: normalizedName,
      type,
      targetScope: targetInfo.targetScope,
      messageIndex: targetInfo.messageIndex,
      messageRole: targetInfo.messageRole,
      targetTextSnapshot: typeof targetTextSnapshot === 'string' ? targetTextSnapshot.slice(0, 2000) : undefined,
    });

    const labels = await getAggregatedLabelsForSample(sampleId, userId, {
      scope: targetInfo.targetScope === 'message' ? 'message' : 'sample',
      messageIndex: targetInfo.messageIndex,
      includeAssignedUsers: true,
    });
    const label = labels.find((item) =>
      item.name === normalizedName
      && item.type === type
      && item.targetScope === targetInfo.targetScope
      && Number(item.messageIndex ?? -1) === Number(targetInfo.messageIndex ?? -1)
      && String(item.messageRole || '') === String(targetInfo.messageRole || '')
    );

    res.status(201).json({ label });
  } catch (error: any) {
    console.error('addLabel error:', error);
    res.status(error.statusCode || 500).json({ error: getErrorMessage(error, 'Failed to create label') });
  }
};

export const removeLabel = async (req: Request, res: Response): Promise<void> => {
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

    const { name, type, targetScope: rawTargetScope, messageIndex: rawMessageIndex, messageRole: rawMessageRole } = req.body as {
      name?: string;
      type?: 'hard' | 'soft';
      targetScope?: 'sample' | 'message';
      messageIndex?: number;
      messageRole?: 'user' | 'assistant';
    };

    if (!name || !String(name).trim()) {
      res.status(400).json({ error: 'name is required' });
      return;
    }
    if (!type || !(['hard', 'soft'] as const).includes(type)) {
      res.status(400).json({ error: "type must be 'hard' or 'soft'" });
      return;
    }

    await assertLabelAccessBySampleId(sampleId, userId, req);
    const targetInfo = validateTargetScopePayload(res, rawTargetScope, rawMessageIndex, rawMessageRole);
    if (!targetInfo) {
      return;
    }

    const removed = await unassignLabelFromSample({
      sampleId,
      userId,
      name: String(name).trim(),
      type,
      targetScope: targetInfo.targetScope,
      messageIndex: targetInfo.messageIndex,
      messageRole: targetInfo.messageRole,
    });

    res.status(200).json({
      removed: Boolean(removed),
      name: String(name).trim(),
      type,
      targetScope: targetInfo.targetScope,
      messageIndex: targetInfo.messageIndex ?? null,
      messageRole: targetInfo.messageRole ?? null,
    });
  } catch (error: any) {
    console.error('removeLabel error:', error);
    res.status(error.statusCode || 500).json({ error: getErrorMessage(error, 'Failed to remove label') });
  }
};

export const voteLabel = async (_req: Request, res: Response): Promise<void> => {
  res.status(410).json({ error: 'Vote-based label API has been removed. Use assign/unassign semantics instead.' });
};
