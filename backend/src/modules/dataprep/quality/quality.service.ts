import mongoose from 'mongoose';
import { DatasetVersion } from '../../../models/DatasetVersion';
import { ProcessedDatasetItem } from '../../../models/ProcessedDatasetItem';
import { Label } from '../../../models/Label';

export const QUALITY_BUCKETS = ['Gold', 'Rewrite', 'Reject'] as const;
export type QualityBucket = (typeof QUALITY_BUCKETS)[number];

const INTENTS = [
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
] as const;

const INTENT_INDEX = new Map(INTENTS.map((intent, index) => [intent, index]));
const CRITICAL_INTENTS = new Set(['INCORRECT', 'REQUEST_HINT'] as const);

const VALID_ACTIONS: Record<string, ReadonlySet<string>> = {
  CORRECT: new Set(['PRAISING']),
  INCORRECT: new Set(['SCAFFOLDING']),
  REQUEST_HINT: new Set(['HINTING', 'SCAFFOLDING']),
  ASK_THEORY: new Set(['CONCEPT_CLARIFY', 'LOGIC_BREAKDOWN']),
  REQUEST_EXPLANATION: new Set(['LOGIC_BREAKDOWN', 'CONCEPT_CLARIFY']),
  REQUEST_SIMPLER: new Set(['SIMPLIFYING']),
  SKIP_EXERCISE: new Set(['NAVIGATING']),
  ENCOURAGE: new Set(['MOTIVATING']),
  OFF_TOPIC: new Set(['REDIRECTING', 'TRANSITIONING']),
  NEXT_SECTION: new Set(['TRANSITIONING', 'NAVIGATING']),
  WAIT_READY: new Set(['WAITING']),
};
const USER_INTENT_SET = new Set<string>(INTENTS);
const ASSISTANT_ACTION_SET = new Set<string>(
  Array.from(new Set(Object.values(VALID_ACTIONS).flatMap((actions) => Array.from(actions))))
);

type SerializedMessage = {
  messageIndex: number;
  role: 'user' | 'assistant';
  content: string;
};

export type QualitySummaryGroup = {
  group: QualityBucket;
  count: number;
  percentage: number;
};

export type QualityWrongPair = {
  intent: string;
  action: string;
  count: number;
  criticalFailures: number;
};

export type QualityItem = {
  _id: string;
  sampleId: string;
  data: Record<string, unknown>;
  bucket: QualityBucket;
  score: number;
  vector: number[];
  intentCounts: number[];
  iar: Array<number | null>;
  criticalFailures: number;
  scorableTurns: number;
};

export type QualityResult = {
  summary: {
    totalSamples: number;
    classifiedSamples: number;
    skippedSamples: number;
    groups: QualitySummaryGroup[];
    wrongPairs: QualityWrongPair[];
    rejectTaggedCount?: number;
  };
  totalSamples: number;
  classifiedSamples: number;
  skippedSamples: number;
  groups: QualitySummaryGroup[];
  wrongPairs: QualityWrongPair[];
  rejectTaggedCount?: number;
  items: QualityItem[];
};

const QUALITY_AUTO_REJECT_MARKER = 'quality-classification:auto-reject';
const HARD_REJECT_FILTER_UPVOTES = 3;

function isQualityBucket(value: string): value is QualityBucket {
  return (QUALITY_BUCKETS as readonly string[]).includes(value);
}

function serializeMessages(data: Record<string, any>): SerializedMessage[] {
  if (Array.isArray(data?.messages)) {
    return data.messages
      .filter((message: any) => message?.role === 'user' || message?.role === 'assistant')
      .map((message: any, index: number) => ({
        messageIndex: index,
        role: message.role,
        content: String(message?.content || ''),
      }));
  }

  const instruction = String(data?.instruction || data?.userText || '').trim();
  const output = String(data?.output || data?.assistantText || '').trim();
  const messages: SerializedMessage[] = [];
  if (instruction) {
    messages.push({ messageIndex: 0, role: 'user', content: instruction });
  }
  if (output) {
    messages.push({ messageIndex: 1, role: 'assistant', content: output });
  }
  return messages;
}

function labelName(label: any): string {
  return String(label?.name || '').trim().toUpperCase();
}

function buildLabelMap(labels: any[]): Map<string, string[]> {
  const grouped = new Map<string, Set<string>>();
  labels.forEach((label) => {
    const role = label.messageRole === 'assistant' || label.messageRole === 'user'
      ? label.messageRole
      : null;
    const keys = role
      ? [`${String(label.sampleId)}:${Number(label.messageIndex)}:${role}`]
      : [
        `${String(label.sampleId)}:${Number(label.messageIndex)}:user`,
        `${String(label.sampleId)}:${Number(label.messageIndex)}:assistant`,
      ];
    keys.forEach((key) => {
      const list = grouped.get(key) || new Set<string>();
      const name = labelName(label);
      if (name) {
        list.add(name);
      }
      grouped.set(key, list);
    });
  });

  const result = new Map<string, string[]>();
  grouped.forEach((items, key) => {
    result.set(key, Array.from(items).sort());
  });
  return result;
}

function incrementWrongPair(map: Map<string, QualityWrongPair>, intent: string, actions: string[], isCritical: boolean) {
  const action = actions.length ? actions.join(' + ') : 'MISSING_VALID_ACTION';
  const key = `${intent}:${action}`;
  const current = map.get(key) || {
    intent,
    action,
    count: 0,
    criticalFailures: 0,
  };
  current.count += 1;
  if (isCritical) {
    current.criticalFailures += 1;
  }
  map.set(key, current);
}

function resolveBucket(score: number): QualityBucket {
  if (score >= 0.8) {
    return 'Gold';
  }
  if (score >= 0.5) {
    return 'Rewrite';
  }
  return 'Reject';
}

export class QualityService {
  async classify(
    versionId: string,
    ownerId: string,
    group?: string,
    options: { tagRejects?: boolean } = {}
  ): Promise<QualityResult> {
    if (!mongoose.Types.ObjectId.isValid(versionId)) {
      throw Object.assign(new Error('Invalid dataset version id.'), { statusCode: 400 });
    }

    const version = await DatasetVersion.findOne({ _id: versionId, ownerId }).lean();
    if (!version) {
      throw Object.assign(new Error('Dataset version not found.'), { statusCode: 404 });
    }

    const items = await ProcessedDatasetItem.find({ datasetVersionId: version._id }).sort({ createdAt: 1 }).lean();
    if (!items.length) {
      return {
        summary: { totalSamples: 0, classifiedSamples: 0, skippedSamples: 0, groups: [], wrongPairs: [], rejectTaggedCount: 0 },
        totalSamples: 0,
        classifiedSamples: 0,
        skippedSamples: 0,
        groups: [],
        wrongPairs: [],
        rejectTaggedCount: 0,
        items: [],
      };
    }

    const itemIds = items.map((item: any) => item._id);
    const labels = await Label.find({
      sampleId: { $in: itemIds },
      targetScope: 'message',
      type: 'hard',
    }).lean();
    const labelMap = buildLabelMap(labels);

    const qualityItems: QualityItem[] = [];
    const wrongPairMap = new Map<string, QualityWrongPair>();

    for (const item of items as any[]) {
      const messages = serializeMessages(item.data || {});
      const vector = new Array(INTENTS.length).fill(0);
      const intentCounts = new Array(INTENTS.length).fill(0);
      let scorableTurns = 0;
      let criticalFailures = 0;

      for (let index = 0; index < messages.length; index += 1) {
        const userMessage = messages[index];
        if (userMessage.role !== 'user') continue;

        const assistantMessage = messages.slice(index + 1).find((message) => message.role === 'assistant');
        if (!assistantMessage) continue;

        const userLabels = (labelMap.get(`${String(item._id)}:${userMessage.messageIndex}:user`) || [])
          .filter((label) => USER_INTENT_SET.has(label));
        const assistantLabels = (labelMap.get(`${String(item._id)}:${assistantMessage.messageIndex}:assistant`) || [])
          .filter((label) => ASSISTANT_ACTION_SET.has(label));
        if (!userLabels.length || !assistantLabels.length) continue;

        for (const userLabel of userLabels) {
          const intentIndex = INTENT_INDEX.get(userLabel as any);
          const validActions = VALID_ACTIONS[userLabel];
          if (intentIndex === undefined || !validActions) continue;

          const matchedActions = assistantLabels.filter((action) => validActions.has(action));
          const isCorrect = matchedActions.length > 0;
          const isCriticalFailure = !isCorrect && CRITICAL_INTENTS.has(userLabel as any);
          const value = isCorrect ? 1 : -1;

          if (!isCorrect) {
            incrementWrongPair(wrongPairMap, userLabel, assistantLabels, isCriticalFailure);
          }

          vector[intentIndex] += value;
          intentCounts[intentIndex] += 1;
          scorableTurns += 1;
          if (isCriticalFailure) {
            criticalFailures += 1;
          }
        }
      }

      if (scorableTurns === 0) {
        continue;
      }

      const score = vector.reduce((sum, value) => sum + value, 0) / scorableTurns;
      const bucket = resolveBucket(score);
      const iar = vector.map((value, index) => (
        intentCounts[index] > 0 ? value / intentCounts[index] : null
      ));

      qualityItems.push({
        _id: String(item._id),
        sampleId: String(item.sampleId),
        data: item.data || {},
        bucket,
        score,
        vector,
        intentCounts,
        iar,
        criticalFailures,
        scorableTurns,
      });
    }

    const filteredItems = group && isQualityBucket(group)
      ? qualityItems.filter((item) => item.bucket === group)
      : qualityItems;

    const groups: QualitySummaryGroup[] = QUALITY_BUCKETS.map((bucket) => {
      const count = qualityItems.filter((item) => item.bucket === bucket).length;
      return {
        group: bucket,
        count,
        percentage: qualityItems.length
          ? Math.round((count / qualityItems.length) * 10000) / 100
          : 0,
      };
    });
    const wrongPairs = Array.from(wrongPairMap.values()).sort((a, b) => {
      if (b.count !== a.count) return b.count - a.count;
      if (b.criticalFailures !== a.criticalFailures) return b.criticalFailures - a.criticalFailures;
      return `${a.intent}:${a.action}`.localeCompare(`${b.intent}:${b.action}`);
    });
    const rejectTaggedCount = options.tagRejects
      ? await this.syncRejectLabels(itemIds, qualityItems, ownerId)
      : 0;

    const result = {
      totalSamples: items.length,
      classifiedSamples: qualityItems.length,
      skippedSamples: items.length - qualityItems.length,
      groups,
      wrongPairs,
      rejectTaggedCount,
      items: filteredItems,
    };
    return {
      summary: {
        totalSamples: result.totalSamples,
        classifiedSamples: result.classifiedSamples,
        skippedSamples: result.skippedSamples,
        groups: result.groups,
        wrongPairs: result.wrongPairs,
        rejectTaggedCount: result.rejectTaggedCount,
      },
      ...result,
    };
  }

  private async syncRejectLabels(itemIds: any[], qualityItems: QualityItem[], ownerId: string): Promise<number> {
    const ownerOid = new mongoose.Types.ObjectId(ownerId);
    const rejectSampleIds = qualityItems
      .filter((item) => item.bucket === 'Reject')
      .map((item) => new mongoose.Types.ObjectId(item._id));

    await Label.deleteMany({
      sampleId: { $in: itemIds },
      name: 'REJECT',
      type: 'hard',
      targetScope: 'sample',
      targetTextSnapshot: QUALITY_AUTO_REJECT_MARKER,
      createdBy: ownerOid,
    });

    if (!rejectSampleIds.length) {
      return 0;
    }

    const docs = rejectSampleIds.map((sampleId) => ({
      sampleId,
      name: 'REJECT',
      type: 'hard' as const,
      targetScope: 'sample' as const,
      targetTextSnapshot: QUALITY_AUTO_REJECT_MARKER,
      createdBy: ownerOid,
      upvotes: Array.from({ length: HARD_REJECT_FILTER_UPVOTES }, () => ownerOid),
      downvotes: [],
    }));

    await Label.insertMany(docs, { ordered: false });
    return docs.length;
  }
}
