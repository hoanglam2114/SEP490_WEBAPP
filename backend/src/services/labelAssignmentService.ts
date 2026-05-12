import mongoose from 'mongoose';
import { DatasetSampleAssignment } from '../models/DatasetSampleAssignment';
import { Label } from '../models/Label';
import { LabelAssignment } from '../models/LabelAssignment';
import { ProcessedDatasetItem } from '../models/ProcessedDatasetItem';
import { DatasetAssignmentActivity } from '../models/DatasetAssignmentActivity';
import { DatasetAssignmentAdjudication } from '../models/DatasetAssignmentAdjudication';
import { DatasetAssignmentSubmission } from '../models/DatasetAssignmentSubmission';
import { User } from '../models/User';
import { QUALITY_AUTO_REJECT_MARKER } from '../modules/dataprep/quality/quality.constants';

export const HARD_LABELS = [
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
] as const;

export type LabelScope = 'sample' | 'message';
export type LabelQueryScope = 'sample' | 'message' | 'all';
export type LabelRole = 'user' | 'assistant';
export type LabelType = 'hard' | 'soft';

export type LabelAssignmentAggregate = {
  _id: string;
  sampleId: string;
  name: string;
  type: LabelType;
  targetScope: LabelScope;
  messageIndex?: number;
  messageRole?: LabelRole;
  targetTextSnapshot?: string;
  createdAt: Date | null;
  updatedAt: Date | null;
  assignedUserCount: number;
  assignedByCurrentUser: boolean;
  assignedUsers?: Array<{ id: string; name: string; email: string }>;
};

type AggregateOptions = {
  scope?: LabelQueryScope;
  messageIndex?: number;
  createdBy?: string;
  contributedBy?: string;
  includeAssignedUsers?: boolean;
};

type TargetDescriptor = {
  targetScope: LabelScope;
  messageIndex?: number;
  messageRole?: LabelRole;
};

type DecisionTarget = TargetDescriptor & {
  key: string;
  labels: string[];
  targetTextSnapshot?: string;
};

function sampleScopeMatch(): Record<string, any> {
  return {
    $or: [
      { targetScope: 'sample' },
      { targetScope: { $exists: false } },
      { targetScope: null },
    ],
  };
}

function buildTargetKey(targetScope: LabelScope, messageIndex?: number | null, messageRole?: LabelRole | null): string {
  return targetScope === 'message'
    ? `message:${Number(messageIndex)}:${String(messageRole || '')}`
    : 'sample';
}

export function normalizeTargetScope(value: unknown): LabelScope {
  return value === 'message' ? 'message' : 'sample';
}

export function normalizeQueryScope(value: unknown): LabelQueryScope {
  return value === 'message' || value === 'all' ? value : 'sample';
}

export function normalizeLabelName(name: unknown, type: LabelType): string {
  const raw = String(name || '').trim();
  return type === 'hard' ? raw.toUpperCase() : raw.toLowerCase();
}

export function isSupportedHardLabel(name: string): boolean {
  return HARD_LABELS.includes(name as any);
}

async function ensureLabelAssignmentsForSampleObjectIds(sampleIds: mongoose.Types.ObjectId[]): Promise<void> {
  if (!sampleIds.length) {
    return;
  }

  const legacyLabels = await Label.find({ sampleId: { $in: sampleIds } }).lean();
  if (!legacyLabels.length) {
    return;
  }

  const docs: any[] = [];
  legacyLabels.forEach((label: any) => {
    const contributorIds = new Set<string>();
    if (label.createdBy) {
      contributorIds.add(String(label.createdBy));
    }
    if (Array.isArray(label.upvotes)) {
      label.upvotes.forEach((userId: any) => contributorIds.add(String(userId)));
    }

    contributorIds.forEach((userId) => {
      if (!mongoose.Types.ObjectId.isValid(userId)) {
        return;
      }
      docs.push({
        sampleId: label.sampleId,
        name: String(label.name || ''),
        type: label.type === 'soft' ? 'soft' : 'hard',
        targetScope: label.targetScope === 'message' ? 'message' : 'sample',
        messageIndex: Number.isInteger(Number(label.messageIndex)) ? Number(label.messageIndex) : null,
        messageRole: label.messageRole === 'user' || label.messageRole === 'assistant' ? label.messageRole : null,
        targetTextSnapshot: label.targetTextSnapshot ? String(label.targetTextSnapshot) : undefined,
        createdBy: new mongoose.Types.ObjectId(userId),
        legacyLabelId: label._id,
      });
    });
  });

  if (!docs.length) {
    return;
  }

  try {
    await LabelAssignment.insertMany(docs, { ordered: false });
  } catch (error: any) {
    if (error?.code !== 11000) {
      throw error;
    }
  }
}

export async function ensureLabelAssignmentsForSamples(sampleIds: Array<string | mongoose.Types.ObjectId>): Promise<void> {
  const validIds = sampleIds
    .map((sampleId) => String(sampleId))
    .filter((sampleId) => mongoose.Types.ObjectId.isValid(sampleId))
    .map((sampleId) => new mongoose.Types.ObjectId(sampleId));
  await ensureLabelAssignmentsForSampleObjectIds(validIds);
}

async function resolveSample(sampleId: string) {
  const sample = await ProcessedDatasetItem.findById(sampleId).select('_id datasetVersionId sampleId').lean();
  if (!sample) {
    const error = new Error('Sample not found');
    (error as any).statusCode = 404;
    throw error;
  }
  return sample;
}

async function recordActivityForAssignment(params: {
  sampleId: mongoose.Types.ObjectId;
  datasetVersionId: mongoose.Types.ObjectId;
  annotatorId: mongoose.Types.ObjectId;
  labelName: string;
  labelType: LabelType;
  targetScope: LabelScope;
  messageIndex?: number | null;
  messageRole?: LabelRole | null;
  activityType: 'assign' | 'unassign';
}) {
  if (params.labelType !== 'hard') {
    return;
  }

  const isAssigned = await DatasetSampleAssignment.exists({
    datasetVersionId: params.datasetVersionId,
    sampleId: params.sampleId,
    assigneeId: params.annotatorId,
  });
  if (!isAssigned) {
    return;
  }

  await DatasetAssignmentActivity.create({
    datasetVersionId: params.datasetVersionId,
    sampleId: params.sampleId,
    annotatorId: params.annotatorId,
    labelName: params.labelName,
    labelType: params.labelType,
    targetScope: params.targetScope,
    messageIndex: params.messageIndex ?? null,
    messageRole: params.messageRole ?? null,
    activityType: params.activityType,
  });
}

function buildAggregateKey(doc: any): string {
  return [
    String(doc.sampleId),
    String(doc.name || ''),
    String(doc.type || 'hard'),
    String(doc.targetScope === 'message' ? 'message' : 'sample'),
    Number.isInteger(Number(doc.messageIndex)) ? Number(doc.messageIndex) : '',
    doc.messageRole === 'user' || doc.messageRole === 'assistant' ? doc.messageRole : '',
  ].join('::');
}

function mergeAggregateDocs(
  docs: any[],
  viewerId: string,
  assignedUserMap: Map<string, { id: string; name: string; email: string }>,
  includeAssignedUsers: boolean
): LabelAssignmentAggregate[] {
  const grouped = new Map<string, LabelAssignmentAggregate & { userIds: Set<string> }>();

  docs.forEach((doc: any) => {
    const key = buildAggregateKey(doc);
    if (!grouped.has(key)) {
      grouped.set(key, {
        _id: key,
        sampleId: String(doc.sampleId),
        name: String(doc.name || ''),
        type: doc.type === 'soft' ? 'soft' : 'hard',
        targetScope: doc.targetScope === 'message' ? 'message' : 'sample',
        messageIndex: Number.isInteger(Number(doc.messageIndex)) ? Number(doc.messageIndex) : undefined,
        messageRole: doc.messageRole === 'user' || doc.messageRole === 'assistant' ? doc.messageRole : undefined,
        targetTextSnapshot: doc.targetTextSnapshot ? String(doc.targetTextSnapshot) : undefined,
        createdAt: doc.createdAt ? new Date(doc.createdAt) : null,
        updatedAt: doc.updatedAt ? new Date(doc.updatedAt) : null,
        assignedUserCount: 0,
        assignedByCurrentUser: false,
        assignedUsers: includeAssignedUsers ? [] : undefined,
        userIds: new Set<string>(),
      });
    }

    const entry = grouped.get(key)!;
    const contributorId = String(doc.createdBy?._id || doc.createdBy || '');
    if (!contributorId || entry.userIds.has(contributorId)) {
      return;
    }

    entry.userIds.add(contributorId);
    entry.assignedUserCount += 1;
    if (contributorId === String(viewerId)) {
      entry.assignedByCurrentUser = true;
    }

    if (includeAssignedUsers) {
      const user = assignedUserMap.get(contributorId);
      if (user && entry.assignedUsers) {
        entry.assignedUsers.push(user);
      }
    }
  });

  return Array.from(grouped.values()).map((item) => {
    const { userIds: _userIds, ...rest } = item;
    return rest;
  });
}

export async function getAggregatedLabelsForSample(
  sampleId: string,
  viewerId: string,
  options: AggregateOptions = {}
): Promise<LabelAssignmentAggregate[]> {
  await ensureLabelAssignmentsForSamples([sampleId]);

  const query: Record<string, any> = {
    sampleId: new mongoose.Types.ObjectId(sampleId),
  };

  const scope = normalizeQueryScope(options.scope);
  if (scope === 'sample') {
    Object.assign(query, sampleScopeMatch());
  } else if (scope === 'message') {
    query.targetScope = 'message';
    if (options.messageIndex !== undefined) {
      query.messageIndex = options.messageIndex;
    }
  }

  const filterUserId = options.createdBy || options.contributedBy;
  if (filterUserId) {
    query.createdBy = new mongoose.Types.ObjectId(filterUserId);
  }

  const docs = await LabelAssignment.find(query)
    .populate('createdBy', 'name email')
    .sort({ createdAt: -1 })
    .lean();

  const contributorIds = Array.from(
    new Set(
      docs
        .map((doc: any) => String(doc.createdBy?._id || doc.createdBy || ''))
        .filter(Boolean)
    )
  );
  const users = contributorIds.length
    ? await User.find({ _id: { $in: contributorIds.map((id) => new mongoose.Types.ObjectId(id)) } })
        .select('_id name email')
        .lean()
    : [];
  const userMap = new Map(
    users.map((user: any) => [
      String(user._id),
      { id: String(user._id), name: String(user.name || ''), email: String(user.email || '') },
    ])
  );

  return mergeAggregateDocs(docs, viewerId, userMap, Boolean(options.includeAssignedUsers));
}

export async function assignLabelToSample(params: {
  sampleId: string;
  userId: string;
  name: string;
  type: LabelType;
  targetScope: LabelScope;
  messageIndex?: number;
  messageRole?: LabelRole;
  targetTextSnapshot?: string;
}) {
  const sample = await resolveSample(params.sampleId);
  await ensureLabelAssignmentsForSamples([params.sampleId]);

  const normalizedName = normalizeLabelName(params.name, params.type);
  const doc = await LabelAssignment.findOneAndUpdate(
    {
      sampleId: sample._id,
      createdBy: new mongoose.Types.ObjectId(params.userId),
      type: params.type,
      name: normalizedName,
      targetScope: params.targetScope,
      messageIndex: params.targetScope === 'message' ? Number(params.messageIndex) : null,
      messageRole: params.targetScope === 'message' ? params.messageRole : null,
    },
    {
      $setOnInsert: {
        targetTextSnapshot: params.targetTextSnapshot,
      },
    },
    { upsert: true, returnDocument: 'after' }
  ).lean();

  await recordActivityForAssignment({
    sampleId: sample._id as any,
    datasetVersionId: sample.datasetVersionId as any,
    annotatorId: new mongoose.Types.ObjectId(params.userId),
    labelName: normalizedName,
    labelType: params.type,
    targetScope: params.targetScope,
    messageIndex: params.targetScope === 'message' ? Number(params.messageIndex) : null,
    messageRole: params.targetScope === 'message' ? params.messageRole : null,
    activityType: 'assign',
  });

  return doc;
}

export async function unassignLabelFromSample(params: {
  sampleId: string;
  userId: string;
  name: string;
  type: LabelType;
  targetScope: LabelScope;
  messageIndex?: number;
  messageRole?: LabelRole;
}) {
  const sample = await resolveSample(params.sampleId);
  await ensureLabelAssignmentsForSamples([params.sampleId]);

  const normalizedName = normalizeLabelName(params.name, params.type);
  const result = await LabelAssignment.findOneAndDelete({
    sampleId: sample._id,
    createdBy: new mongoose.Types.ObjectId(params.userId),
    type: params.type,
    name: normalizedName,
    targetScope: params.targetScope,
    messageIndex: params.targetScope === 'message' ? Number(params.messageIndex) : null,
    messageRole: params.targetScope === 'message' ? params.messageRole : null,
  }).lean();

  if (result) {
    await recordActivityForAssignment({
      sampleId: sample._id as any,
      datasetVersionId: sample.datasetVersionId as any,
      annotatorId: new mongoose.Types.ObjectId(params.userId),
      labelName: normalizedName,
      labelType: params.type,
      targetScope: params.targetScope,
      messageIndex: params.targetScope === 'message' ? Number(params.messageIndex) : null,
      messageRole: params.targetScope === 'message' ? params.messageRole : null,
      activityType: 'unassign',
    });
  }

  return result;
}

export async function replaceHardLabelsForUserOnTarget(params: {
  sampleId: string;
  userId: string;
  targetScope: LabelScope;
  messageIndex?: number;
  messageRole?: LabelRole;
  labels: string[];
  targetTextSnapshot?: string;
}) {
  const sample = await resolveSample(params.sampleId);
  await ensureLabelAssignmentsForSamples([params.sampleId]);

  const normalizedLabels = Array.from(
    new Set(
      (params.labels || [])
        .map((label) => normalizeLabelName(label, 'hard'))
        .filter(Boolean)
    )
  );

  const filter = {
    sampleId: sample._id,
    createdBy: new mongoose.Types.ObjectId(params.userId),
    type: 'hard',
    targetScope: params.targetScope,
    messageIndex: params.targetScope === 'message' ? Number(params.messageIndex) : null,
    messageRole: params.targetScope === 'message' ? params.messageRole : null,
  } as Record<string, any>;

  const existing = await LabelAssignment.find(filter).lean();
  const existingNames = new Set(existing.map((doc: any) => String(doc.name || '').toUpperCase()));
  const nextNames = new Set(normalizedLabels);

  const toDelete = existing.filter((doc: any) => !nextNames.has(String(doc.name || '').toUpperCase()));
  const toCreate = normalizedLabels.filter((name) => !existingNames.has(name));

  if (toDelete.length) {
    await LabelAssignment.deleteMany({ _id: { $in: toDelete.map((doc: any) => doc._id) } });
    await Promise.all(
      toDelete.map((doc: any) =>
        recordActivityForAssignment({
          sampleId: sample._id as any,
          datasetVersionId: sample.datasetVersionId as any,
          annotatorId: new mongoose.Types.ObjectId(params.userId),
          labelName: String(doc.name || ''),
          labelType: 'hard',
          targetScope: params.targetScope,
          messageIndex: params.targetScope === 'message' ? Number(params.messageIndex) : null,
          messageRole: params.targetScope === 'message' ? params.messageRole : null,
          activityType: 'unassign',
        })
      )
    );
  }

  if (toCreate.length) {
    const docs = toCreate.map((name) => ({
      sampleId: sample._id,
      createdBy: new mongoose.Types.ObjectId(params.userId),
      type: 'hard',
      name,
      targetScope: params.targetScope,
      messageIndex: params.targetScope === 'message' ? Number(params.messageIndex) : null,
      messageRole: params.targetScope === 'message' ? params.messageRole : null,
      targetTextSnapshot: params.targetTextSnapshot,
    }));
    await LabelAssignment.insertMany(docs, { ordered: false });
    await Promise.all(
      toCreate.map((name) =>
        recordActivityForAssignment({
          sampleId: sample._id as any,
          datasetVersionId: sample.datasetVersionId as any,
          annotatorId: new mongoose.Types.ObjectId(params.userId),
          labelName: name,
          labelType: 'hard',
          targetScope: params.targetScope,
          messageIndex: params.targetScope === 'message' ? Number(params.messageIndex) : null,
          messageRole: params.targetScope === 'message' ? params.messageRole : null,
          activityType: 'assign',
        })
      )
    );
  }
}

export async function removeLabelsByQuery(query: Record<string, any>) {
  await LabelAssignment.deleteMany(query);
}

export async function insertAssignments(docs: any[]) {
  if (!docs.length) {
    return;
  }
  try {
    await LabelAssignment.insertMany(docs, { ordered: false });
  } catch (error: any) {
    if (error?.code !== 11000) {
      throw error;
    }
  }
}

export async function getHardRejectedSampleIds(scopedSampleIds?: mongoose.Types.ObjectId[]): Promise<Set<string>> {
  await ensureLabelAssignmentsForSamples((scopedSampleIds || []).map((id) => String(id)));

  const match: Record<string, any> = {
    name: 'REJECT',
    type: 'hard',
    targetTextSnapshot: { $ne: QUALITY_AUTO_REJECT_MARKER },
    $or: [
      { targetScope: 'sample' },
      { targetScope: { $exists: false } },
      { targetScope: null },
    ],
  };
  if (scopedSampleIds && scopedSampleIds.length) {
    match.sampleId = { $in: scopedSampleIds };
  }

  const rows = await LabelAssignment.aggregate([
    { $match: match },
    { $group: { _id: '$sampleId', contributorCount: { $addToSet: '$createdBy' } } },
    { $project: { contributorCount: { $size: '$contributorCount' } } },
    { $match: { contributorCount: { $gt: 0 } } },
  ]);

  return new Set(rows.map((row: any) => String(row._id)));
}

export async function getTopLabelForSampleIds(sampleIds: mongoose.Types.ObjectId[]) {
  await ensureLabelAssignmentsForSamples(sampleIds.map((id) => String(id)));
  const rows = await LabelAssignment.aggregate([
    { $match: { sampleId: { $in: sampleIds } } },
    {
      $group: {
        _id: { name: '$name', type: '$type' },
        contributors: { $addToSet: '$createdBy' },
        latestCreatedAt: { $max: '$createdAt' },
      },
    },
    {
      $project: {
        name: '$_id.name',
        type: '$_id.type',
        assignedUserCount: { $size: '$contributors' },
        latestCreatedAt: 1,
      },
    },
    { $sort: { assignedUserCount: -1, latestCreatedAt: -1 } },
    { $limit: 1 },
  ]);

  return rows[0] || null;
}

export async function getAggregatedSampleLabels(sampleIds: mongoose.Types.ObjectId[]) {
  await ensureLabelAssignmentsForSamples(sampleIds.map((id) => String(id)));
  return LabelAssignment.aggregate([
    { $match: { sampleId: { $in: sampleIds } } },
    {
      $group: {
        _id: {
          sampleId: '$sampleId',
          name: '$name',
          type: '$type',
          targetScope: '$targetScope',
          messageIndex: '$messageIndex',
          messageRole: '$messageRole',
        },
        contributors: { $addToSet: '$createdBy' },
      },
    },
    {
      $project: {
        sampleId: '$_id.sampleId',
        name: '$_id.name',
        type: '$_id.type',
        targetScope: '$_id.targetScope',
        messageIndex: '$_id.messageIndex',
        messageRole: '$_id.messageRole',
        assignedUserCount: { $size: '$contributors' },
      },
    },
  ]);
}

export async function getContributorCountsForSample(sampleIds: mongoose.Types.ObjectId[]) {
  await ensureLabelAssignmentsForSamples(sampleIds.map((id) => String(id)));
  const rows = await LabelAssignment.aggregate([
    { $match: { sampleId: { $in: sampleIds } } },
    {
      $group: {
        _id: {
          sampleId: '$sampleId',
          name: '$name',
          type: '$type',
        },
        contributors: { $addToSet: '$createdBy' },
      },
    },
    {
      $project: {
        sampleId: '$_id.sampleId',
        name: '$_id.name',
        type: '$_id.type',
        assignedUserCount: { $size: '$contributors' },
      },
    },
  ]);
  return rows;
}

function getLogicalMessagesForSample(sample: any): Array<{ messageIndex: number; role: LabelRole; content: string }> {
  if (Array.isArray(sample?.data?.messages)) {
    return sample.data.messages
      .map((message: any, index: number) => ({
        messageIndex: index,
        role: message?.role === 'assistant' ? 'assistant' : 'user',
        content: String(message?.content || ''),
      }))
      .filter((message: any) => message.content.trim().length > 0);
  }

  return [
    {
      messageIndex: 0,
      role: 'user' as const,
      content: [sample?.data?.instruction, sample?.data?.input]
        .map((part) => String(part || '').trim())
        .filter(Boolean)
        .join('\n\n'),
    },
    {
      messageIndex: 1,
      role: 'assistant' as const,
      content: String(sample?.data?.output || ''),
    },
  ].filter((message) => message.content.trim().length > 0);
}

function buildRequiredTargets(sample: any): DecisionTarget[] {
  const conversationContent = Array.isArray(sample?.data?.messages)
    ? sample.data.messages.map((message: any) => String(message?.content || '')).join('\n')
    : [sample?.data?.instruction, sample?.data?.input, sample?.data?.output].map((part) => String(part || '')).join('\n');

  return [
    {
      key: buildTargetKey('sample'),
      targetScope: 'sample',
      labels: [],
      targetTextSnapshot: conversationContent.slice(0, 2000),
    },
    ...getLogicalMessagesForSample(sample).map((message) => ({
      key: buildTargetKey('message', message.messageIndex, message.role),
      targetScope: 'message' as const,
      messageIndex: message.messageIndex,
      messageRole: message.role,
      labels: [],
      targetTextSnapshot: message.content.slice(0, 2000),
    })),
  ];
}

export async function calculateAssignmentProgressFromAssignments(datasetVersionId: mongoose.Types.ObjectId, assigneeId: string) {
  const assigneeObjectId = new mongoose.Types.ObjectId(assigneeId);
  const assignments = await DatasetSampleAssignment.find({ datasetVersionId, assigneeId: assigneeObjectId })
    .sort({ sampleIndex: 1 })
    .lean();

  const sampleIds = assignments.map((assignment: any) => assignment.sampleId);
  await ensureLabelAssignmentsForSamples(sampleIds.map((id: any) => String(id)));

  const samples = sampleIds.length
    ? await ProcessedDatasetItem.find({ _id: { $in: sampleIds } }).lean()
    : [];
  const sampleMap = new Map(samples.map((sample: any) => [String(sample._id), sample]));

  const decisions = sampleIds.length
    ? await LabelAssignment.find({
        sampleId: { $in: sampleIds },
        createdBy: assigneeObjectId,
        type: 'hard',
      })
        .select('sampleId targetScope messageIndex messageRole name')
        .lean()
    : [];

  const completed = new Map<string, Set<string>>();
  decisions.forEach((decision: any) => {
    const sampleKey = String(decision.sampleId);
    const targetKey = buildTargetKey(
      decision.targetScope === 'message' ? 'message' : 'sample',
      Number.isInteger(Number(decision.messageIndex)) ? Number(decision.messageIndex) : null,
      decision.messageRole === 'user' || decision.messageRole === 'assistant' ? decision.messageRole : null
    );
    if (!completed.has(sampleKey)) {
      completed.set(sampleKey, new Set<string>());
    }
    completed.get(sampleKey)!.add(targetKey);
  });

  let requiredTargets = 0;
  let completedTargets = 0;
  const missing: Array<{ sampleId: string; sampleIndex: number; sampleKey: string; targetScope: LabelScope; messageIndex?: number; role?: string }> = [];

  assignments.forEach((assignment: any) => {
    const sample = sampleMap.get(String(assignment.sampleId));
    if (!sample) {
      return;
    }

    const required = buildRequiredTargets(sample);
    const completedTargetsForSample = completed.get(String(sample._id)) || new Set<string>();
    required.forEach((target) => {
      requiredTargets += 1;
      if (completedTargetsForSample.has(target.key)) {
        completedTargets += 1;
        return;
      }
      missing.push({
        sampleId: String(sample._id),
        sampleIndex: Number(assignment.sampleIndex),
        sampleKey: String(sample.sampleId || ''),
        targetScope: target.targetScope,
        ...(target.targetScope === 'message'
          ? { messageIndex: target.messageIndex, role: target.messageRole }
          : {}),
      });
    });
  });

  return {
    assignedSamples: assignments.length,
    requiredMessages: requiredTargets,
    completedMessages: completedTargets,
    missingMessages: missing,
    percent: requiredTargets > 0 ? Math.round((completedTargets / requiredTargets) * 100) : 0,
    isComplete: requiredTargets > 0 && completedTargets === requiredTargets,
  };
}

function computeJaccard(a: Set<string>, b: Set<string>): number {
  const union = new Set<string>([...a, ...b]);
  if (!union.size) {
    return 1;
  }
  let intersectionCount = 0;
  union.forEach((value) => {
    if (a.has(value) && b.has(value)) {
      intersectionCount += 1;
    }
  });
  return intersectionCount / union.size;
}

function computeMajorityLabels(annotatorSets: Array<{ annotatorId: string; labels: string[] }>) {
  const counts = new Map<string, number>();
  annotatorSets.forEach((annotatorSet) => {
    Array.from(new Set(annotatorSet.labels)).forEach((label) => {
      counts.set(label, (counts.get(label) || 0) + 1);
    });
  });
  const totalAnnotators = annotatorSets.length;
  const labelCounts = Array.from(counts.entries())
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  const majorityLabels = labelCounts.filter((item) => item.count > totalAnnotators / 2).map((item) => item.name);
  return { labelCounts, majorityLabels };
}

function computeAgreement(annotatorSets: Array<{ annotatorId: string; labels: string[] }>): number | null {
  if (annotatorSets.length < 2) {
    return null;
  }
  const scores: number[] = [];
  for (let i = 0; i < annotatorSets.length; i += 1) {
    for (let j = i + 1; j < annotatorSets.length; j += 1) {
      scores.push(computeJaccard(new Set(annotatorSets[i].labels), new Set(annotatorSets[j].labels)));
    }
  }
  if (!scores.length) {
    return null;
  }
  return Number((scores.reduce((sum, value) => sum + value, 0) / scores.length).toFixed(4));
}

async function syncAdjudicationForTarget(params: {
  datasetVersionId: mongoose.Types.ObjectId;
  sampleId: mongoose.Types.ObjectId;
  targetScope: LabelScope;
  messageIndex?: number | null;
  messageRole?: LabelRole | null;
  annotatorSets: Array<{ annotatorId: string; labels: string[] }>;
  agreementScore: number | null;
  majorityLabels: string[];
  labelCounts: Array<{ name: string; count: number }>;
  threshold?: number;
}) {
  const threshold = params.threshold ?? 0.6;
  if (params.agreementScore === null || params.agreementScore >= threshold) {
    await DatasetAssignmentAdjudication.deleteOne({
      datasetVersionId: params.datasetVersionId,
      sampleId: params.sampleId,
      targetScope: params.targetScope,
      messageIndex: params.targetScope === 'message' ? params.messageIndex ?? null : null,
      messageRole: params.targetScope === 'message' ? params.messageRole ?? null : null,
      status: 'pending',
    });
    return;
  }

  await DatasetAssignmentAdjudication.findOneAndUpdate(
    {
      datasetVersionId: params.datasetVersionId,
      sampleId: params.sampleId,
      targetScope: params.targetScope,
      messageIndex: params.targetScope === 'message' ? params.messageIndex ?? null : null,
      messageRole: params.targetScope === 'message' ? params.messageRole ?? null : null,
    },
    {
      $set: {
        status: 'pending',
        threshold,
        agreementScore: params.agreementScore,
        majorityLabels: params.majorityLabels,
        labelCounts: params.labelCounts,
        annotatorSets: params.annotatorSets,
      },
      $setOnInsert: {
        finalLabels: [],
        note: '',
      },
      $unset: {
        resolvedBy: 1,
        resolvedAt: 1,
      },
    },
    { upsert: true }
  );
}

export async function buildAssignmentSampleComparison(datasetVersionId: string, sampleId: string) {
  if (!mongoose.Types.ObjectId.isValid(datasetVersionId) || !mongoose.Types.ObjectId.isValid(sampleId)) {
    throw Object.assign(new Error('Invalid datasetVersionId or sampleId.'), { statusCode: 400 });
  }

  const sample = await ProcessedDatasetItem.findById(sampleId).lean();
  if (!sample) {
    throw Object.assign(new Error('Sample not found.'), { statusCode: 404 });
  }

  const sampleOid = new mongoose.Types.ObjectId(sampleId);
  const versionOid = new mongoose.Types.ObjectId(datasetVersionId);
  await ensureLabelAssignmentsForSamples([sampleId]);

  const assignments = await DatasetSampleAssignment.find({
    datasetVersionId: versionOid,
    sampleId: sampleOid,
  }).lean();

  const assigneeIds = Array.from(new Set(assignments.map((item: any) => String(item.assigneeId)).filter(Boolean)));
  const hardAssignments = assigneeIds.length
    ? await LabelAssignment.find({
        sampleId: sampleOid,
        type: 'hard',
        createdBy: { $in: assigneeIds.map((id) => new mongoose.Types.ObjectId(id)) },
      }).lean()
    : [];
  const adjudications = await DatasetAssignmentAdjudication.find({
    datasetVersionId: versionOid,
    sampleId: sampleOid,
  }).lean();
  const adjudicationMap = new Map(
    adjudications.map((item: any) => [
      buildTargetKey(
        item.targetScope === 'message' ? 'message' : 'sample',
        Number.isInteger(Number(item.messageIndex)) ? Number(item.messageIndex) : null,
        item.messageRole === 'user' || item.messageRole === 'assistant' ? item.messageRole : null
      ),
      item,
    ])
  );

  const userRows = assigneeIds.length
    ? await User.find({ _id: { $in: assigneeIds.map((id) => new mongoose.Types.ObjectId(id)) } }).select('_id name email').lean()
    : [];
  const userMap = new Map(
    userRows.map((user: any) => [
      String(user._id),
      { id: String(user._id), name: String(user.name || ''), email: String(user.email || '') },
    ])
  );

  const decisionsByTarget = new Map<string, Map<string, Set<string>>>();
  hardAssignments.forEach((doc: any) => {
    const targetKey = buildTargetKey(
      doc.targetScope === 'message' ? 'message' : 'sample',
      Number.isInteger(Number(doc.messageIndex)) ? Number(doc.messageIndex) : null,
      doc.messageRole === 'user' || doc.messageRole === 'assistant' ? doc.messageRole : null
    );
    const annotatorId = String(doc.createdBy);
    if (!decisionsByTarget.has(targetKey)) {
      decisionsByTarget.set(targetKey, new Map<string, Set<string>>());
    }
    if (!decisionsByTarget.get(targetKey)!.has(annotatorId)) {
      decisionsByTarget.get(targetKey)!.set(annotatorId, new Set<string>());
    }
    decisionsByTarget.get(targetKey)!.get(annotatorId)!.add(String(doc.name || '').toUpperCase());
  });

  const requiredTargets = buildRequiredTargets(sample);
  const targetComparisons = await Promise.all(
    requiredTargets.map(async (target) => {
      const targetKey = target.key;
      const perUserMap = decisionsByTarget.get(targetKey) || new Map<string, Set<string>>();
      const annotatorSets = assigneeIds
        .map((annotatorId) => ({
          annotatorId,
          labels: Array.from(perUserMap.get(annotatorId) || new Set<string>()).sort(),
        }))
        .filter((item) => item.labels.length > 0);

      const { labelCounts, majorityLabels } = computeMajorityLabels(annotatorSets);
      const agreementScore = computeAgreement(annotatorSets);
      await syncAdjudicationForTarget({
        datasetVersionId: versionOid,
        sampleId: sampleOid,
        targetScope: target.targetScope,
        messageIndex: target.messageIndex ?? null,
        messageRole: target.messageRole ?? null,
        annotatorSets,
        agreementScore,
        majorityLabels,
        labelCounts,
      });
      const adjudication = adjudicationMap.get(targetKey);

      return {
        targetKey,
        targetScope: target.targetScope,
        messageIndex: target.messageIndex,
        messageRole: target.messageRole,
        targetTextSnapshot: target.targetTextSnapshot,
        agreementScore,
        hasConflict: agreementScore !== null && agreementScore < 0.6,
        labelCounts,
        majorityLabels,
        annotators: annotatorSets.map((item) => ({
          annotator: userMap.get(item.annotatorId) || { id: item.annotatorId, name: '', email: '' },
          labels: item.labels,
        })),
        adjudication: adjudication
          ? {
              status: adjudication.status,
              finalLabels: Array.isArray(adjudication.finalLabels) ? adjudication.finalLabels : [],
              note: String(adjudication.note || ''),
              resolvedAt: adjudication.resolvedAt || null,
              resolvedBy: adjudication.resolvedBy ? String(adjudication.resolvedBy) : null,
            }
          : null,
      };
    })
  );

  const targetScores = targetComparisons
    .map((item) => item.agreementScore)
    .filter((value): value is number => typeof value === 'number');

  return {
    sample: {
      id: String(sample._id),
      sampleKey: String(sample.sampleId || ''),
      preview: requiredTargets.map((target) => target.targetTextSnapshot || '').join(' ').trim().slice(0, 180),
    },
    agreementScore: targetScores.length
      ? Number((targetScores.reduce((sum, value) => sum + value, 0) / targetScores.length).toFixed(4))
      : null,
    hasConflict: targetComparisons.some((item) => item.hasConflict),
    pendingAdjudicationCount: targetComparisons.filter((item) => item.hasConflict && item.adjudication?.status !== 'resolved').length,
    targets: targetComparisons,
  };
}

export async function resolveAssignmentAdjudication(params: {
  datasetVersionId: string;
  sampleId: string;
  targetScope: LabelScope;
  messageIndex?: number;
  messageRole?: LabelRole;
  finalLabels: string[];
  note?: string;
  resolvedBy: string;
}) {
  const comparison = await buildAssignmentSampleComparison(params.datasetVersionId, params.sampleId);
  const targetKey = buildTargetKey(params.targetScope, params.messageIndex ?? null, params.messageRole ?? null);
  const target = comparison.targets.find((item) => item.targetKey === targetKey);
  if (!target) {
    throw Object.assign(new Error('Target not found.'), { statusCode: 404 });
  }

  return DatasetAssignmentAdjudication.findOneAndUpdate(
    {
      datasetVersionId: new mongoose.Types.ObjectId(params.datasetVersionId),
      sampleId: new mongoose.Types.ObjectId(params.sampleId),
      targetScope: params.targetScope,
      messageIndex: params.targetScope === 'message' ? params.messageIndex ?? null : null,
      messageRole: params.targetScope === 'message' ? params.messageRole ?? null : null,
    },
    {
      $set: {
        status: 'resolved',
        threshold: 0.6,
        agreementScore: target.agreementScore,
        majorityLabels: target.majorityLabels,
        labelCounts: target.labelCounts,
        annotatorSets: target.annotators.map((item) => ({
          annotatorId: item.annotator.id,
          labels: item.labels,
        })),
        finalLabels: Array.from(new Set((params.finalLabels || []).map((label) => String(label || '').trim().toUpperCase()).filter(Boolean))),
        note: String(params.note || ''),
        resolvedBy: new mongoose.Types.ObjectId(params.resolvedBy),
        resolvedAt: new Date(),
      },
    },
    { upsert: true, returnDocument: 'after' }
  ).lean();
}

export async function buildAssignmentConflictList(datasetVersionId: string, filters?: {
  status?: 'pending' | 'resolved';
  assigneeId?: string;
  sampleIndex?: number;
  minAgreement?: number;
}) {
  const versionOid = new mongoose.Types.ObjectId(datasetVersionId);
  const assignmentRows = await DatasetSampleAssignment.find({ datasetVersionId: versionOid })
    .sort({ sampleIndex: 1 })
    .lean();

  const sampleIds = Array.from(new Set(assignmentRows.map((row: any) => String(row.sampleId))));
  const samples = await ProcessedDatasetItem.find({ _id: { $in: sampleIds } }).select('_id sampleId data').lean();
  const sampleMap = new Map(samples.map((sample: any) => [String(sample._id), sample]));

  const results: any[] = [];
  for (const sampleId of sampleIds) {
    const assignmentsForSample = assignmentRows.filter((row: any) => String(row.sampleId) === sampleId);
    if (filters?.assigneeId && !assignmentsForSample.some((row: any) => String(row.assigneeId) === String(filters.assigneeId))) {
      continue;
    }
    const sampleIndex = Number(assignmentsForSample[0]?.sampleIndex || 0);
    if (filters?.sampleIndex && sampleIndex !== filters.sampleIndex) {
      continue;
    }
    const comparison = await buildAssignmentSampleComparison(datasetVersionId, sampleId);
    if (!comparison.hasConflict) {
      continue;
    }
    if (filters?.minAgreement !== undefined && typeof comparison.agreementScore === 'number' && comparison.agreementScore < filters.minAgreement) {
      continue;
    }
    const resolvedCount = comparison.targets.filter((target) => target.adjudication?.status === 'resolved').length;
    const pendingCount = comparison.targets.filter((target) => target.hasConflict && target.adjudication?.status !== 'resolved').length;
    const status = pendingCount > 0 ? 'pending' : 'resolved';
    if (filters?.status && status !== filters.status) {
      continue;
    }

    results.push({
      sampleId,
      sampleKey: String(sampleMap.get(sampleId)?.sampleId || ''),
      sampleIndex,
      assigneeCount: assignmentsForSample.length,
      agreementScore: comparison.agreementScore,
      pendingAdjudicationCount: pendingCount,
      resolvedAdjudicationCount: resolvedCount,
      status,
    });
  }

  return results.sort((a, b) => a.sampleIndex - b.sampleIndex);
}

export async function buildAssignmentDashboard(datasetVersionId: string) {
  const versionOid = new mongoose.Types.ObjectId(datasetVersionId);
  const assignments = await DatasetSampleAssignment.find({ datasetVersionId: versionOid })
    .sort({ sampleIndex: 1 })
    .lean();
  const sampleIds = Array.from(new Set(assignments.map((row: any) => String(row.sampleId))));
  await ensureLabelAssignmentsForSamples(sampleIds);

  const assigneeIds = Array.from(new Set(assignments.map((row: any) => String(row.assigneeId)).filter(Boolean)));
  const users = assigneeIds.length
    ? await User.find({ _id: { $in: assigneeIds.map((id) => new mongoose.Types.ObjectId(id)) } }).select('_id name email').lean()
    : [];
  const userMap = new Map(users.map((user: any) => [String(user._id), user]));
  const submissions = assigneeIds.length
    ? await DatasetAssignmentSubmission.find({
        datasetVersionId: versionOid,
        assigneeId: { $in: assigneeIds.map((id) => new mongoose.Types.ObjectId(id)) },
      }).lean()
    : [];
  const submissionMap = new Map(submissions.map((item: any) => [String(item.assigneeId), item]));

  const now = Date.now();
  const hourAgo = new Date(now - (60 * 60 * 1000));
  const activityRows = await DatasetAssignmentActivity.find({
    datasetVersionId: versionOid,
    createdAt: { $gte: hourAgo },
  }).lean();
  const latestActivityRows = await DatasetAssignmentActivity.aggregate([
    { $match: { datasetVersionId: versionOid } },
    { $sort: { createdAt: -1 } },
    {
      $group: {
        _id: '$annotatorId',
        latestActivityAt: { $first: '$createdAt' },
      },
    },
  ]);
  const latestActivityMap = new Map(latestActivityRows.map((row: any) => [String(row._id), row.latestActivityAt]));

  const userRows = await Promise.all(
    assigneeIds.map(async (assigneeId) => {
      const progress = await calculateAssignmentProgressFromAssignments(versionOid, assigneeId);
      const hourCount = activityRows.filter((row: any) => String(row.annotatorId) === assigneeId && row.activityType === 'assign').length;
      return {
        user: {
          id: assigneeId,
          name: String((userMap.get(assigneeId) as any)?.name || ''),
          email: String((userMap.get(assigneeId) as any)?.email || ''),
        },
        assignedSamples: assignments.filter((row: any) => String(row.assigneeId) === assigneeId).length,
        completedTargets: progress.completedMessages,
        totalTargets: progress.requiredMessages,
        completionPercent: progress.percent,
        labelsPerHour: hourCount,
        latestActivityAt: latestActivityMap.get(assigneeId) || null,
        submission: submissionMap.get(assigneeId)
          ? {
              status: String((submissionMap.get(assigneeId) as any).status || 'draft'),
              submittedAt: (submissionMap.get(assigneeId) as any).submittedAt || null,
              approvedAt: (submissionMap.get(assigneeId) as any).approvedAt || null,
            }
          : null,
      };
    })
  );

  const conflicts = await buildAssignmentConflictList(datasetVersionId);
  const submittedCount = userRows.filter((row) => row.submission?.status === 'submitted').length;
  const approvedCount = userRows.filter((row) => row.submission?.status === 'approved').length;
  const inProgressCount = userRows.filter((row) => row.completionPercent > 0 && row.completionPercent < 100).length;

  return {
    overview: {
      totalAssignedSamples: sampleIds.length,
      totalAssignees: assigneeIds.length,
      inProgressAssignees: inProgressCount,
      submittedAssignees: submittedCount,
      approvedAssignees: approvedCount,
      pendingConflicts: conflicts.filter((item) => item.status === 'pending').length,
    },
    users: userRows,
    conflicts,
    refreshedAt: new Date().toISOString(),
  };
}
