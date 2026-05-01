import mongoose from 'mongoose';
import { Label } from '../../../models/Label';
import { DatasetVersion } from '../../../models/DatasetVersion';
import { ProcessedDatasetItem } from '../../../models/ProcessedDatasetItem';

/**
 * The 8 classification groups.
 *
 * Priority order when a sample qualifies for multiple groups:
 *   1. REJECT   – hard-REJECT label with ≥ 3 upvotes
 *   2. REWRITE  – any of ERROR_FORMULAR | ERROR_RESPONSE | ERROR_FORMAT | USER_SPAM
 *   3. Subject  – MATH | PHYSICAL | CHEMISTRY | LITERATURE | BIOLOGY
 *   4. OUT_OF_SCOPE – everything else
 */
export const CLASSIFICATION_GROUPS = [
  'MATH',
  'PHYSICAL',
  'CHEMISTRY',
  'LITERATURE',
  'BIOLOGY',
  'REJECT',
  'REWRITE',
  'OUT_OF_SCOPE',
] as const;

export type ClassificationGroup = (typeof CLASSIFICATION_GROUPS)[number];

const SUBJECT_LABELS: ReadonlySet<string> = new Set([
  'MATH',
  'PHYSICAL',
  'CHEMISTRY',
  'LITERATURE',
  'BIOLOGY',
]);

const REWRITE_LABELS: ReadonlySet<string> = new Set([
  'ERROR_FORMULAR',
  'ERROR_RESPONSE',
  'ERROR_FORMAT',
  'USER_SPAM',
]);

const HARD_REJECT_UPVOTE_THRESHOLD = 3;

export type ClassificationSummaryGroup = {
  group: ClassificationGroup;
  count: number;
  percentage: number;
};

export type SampleClassification = {
  sampleId: string;
  group: ClassificationGroup;
};

export type ClassificationResult = {
  totalSamples: number;
  groups: ClassificationSummaryGroup[];
  sampleClassifications: SampleClassification[];
};

export class ClassificationService {
  /**
   * Classify every sample in the given dataset version according to its labels.
   */
  async classify(versionId: string, ownerId: string): Promise<ClassificationResult> {
    if (!mongoose.Types.ObjectId.isValid(versionId)) {
      throw Object.assign(new Error('Invalid dataset version id.'), { statusCode: 400 });
    }

    const version = await DatasetVersion.findOne({ _id: versionId, ownerId }).lean();
    if (!version) {
      throw Object.assign(new Error('Dataset version not found.'), { statusCode: 404 });
    }

    // 1. Load all samples for this version
    const items = await ProcessedDatasetItem.find({ datasetVersionId: version._id })
      .select('_id sampleId')
      .lean();

    if (!items.length) {
      return { totalSamples: 0, groups: [], sampleClassifications: [] };
    }

    const sampleOids = items.map((item: any) => new mongoose.Types.ObjectId(String(item._id)));

    // 2. Load all labels associated with these samples
    const labels = await Label.find({
      sampleId: { $in: sampleOids },
      $or: [
        { targetScope: 'sample' },
        { targetScope: { $exists: false } },
        { targetScope: null },
      ],
    }).lean();

    // 3. Build per-sample label index
    const sampleLabelsMap = new Map<string, Array<{ name: string; type: string; upvoteCount: number }>>();

    for (const label of labels) {
      const sid = String((label as any).sampleId);
      const entry = {
        name: String((label as any).name || '').toUpperCase(),
        type: String((label as any).type || ''),
        upvoteCount: Array.isArray((label as any).upvotes) ? (label as any).upvotes.length : 0,
      };
      const list = sampleLabelsMap.get(sid) || [];
      list.push(entry);
      sampleLabelsMap.set(sid, list);
    }

    // 4. Classify each sample
    const sampleClassifications: SampleClassification[] = [];
    const groupCounts = new Map<ClassificationGroup, number>();

    for (const item of items) {
      const sid = String((item as any)._id);
      const sampleLabels = sampleLabelsMap.get(sid) || [];
      const group = this.resolveGroup(sampleLabels);

      sampleClassifications.push({ sampleId: sid, group });
      groupCounts.set(group, (groupCounts.get(group) || 0) + 1);
    }

    // 5. Build summary
    const totalSamples = items.length;
    const groups: ClassificationSummaryGroup[] = CLASSIFICATION_GROUPS
      .map((group) => ({
        group,
        count: groupCounts.get(group) || 0,
        percentage: totalSamples > 0
          ? Math.round(((groupCounts.get(group) || 0) / totalSamples) * 10000) / 100
          : 0,
      }))
      .filter((g) => g.count > 0);

    return { totalSamples, groups, sampleClassifications };
  }

  /**
   * Return classified samples for a version, optionally filtered by group.
   */
  async getClassifiedSamples(
    versionId: string,
    ownerId: string,
    group?: string
  ): Promise<{
    totalSamples: number;
    groups: ClassificationSummaryGroup[];
    items: Array<{ _id: string; sampleId: string; data: Record<string, unknown>; group: ClassificationGroup }>;
  }> {
    const classification = await this.classify(versionId, ownerId);

    // Build a lookup: sampleId → group
    const groupMap = new Map<string, ClassificationGroup>();
    for (const sc of classification.sampleClassifications) {
      groupMap.set(sc.sampleId, sc.group);
    }

    // Load full sample data
    const version = await DatasetVersion.findOne({ _id: versionId, ownerId }).lean();
    if (!version) {
      throw Object.assign(new Error('Dataset version not found.'), { statusCode: 404 });
    }

    const items = await ProcessedDatasetItem.find({ datasetVersionId: version._id }).lean();

    const enriched = items.map((item: any) => ({
      _id: String(item._id),
      sampleId: String(item.sampleId),
      data: item.data || {},
      group: groupMap.get(String(item._id)) || ('OUT_OF_SCOPE' as ClassificationGroup),
    }));

    const filtered = group
      ? enriched.filter((item) => item.group === group.toUpperCase())
      : enriched;

    return {
      totalSamples: classification.totalSamples,
      groups: classification.groups,
      items: filtered,
    };
  }

  /**
   * Determine the classification group for a single sample based on its labels.
   *
   * Priority: REJECT > REWRITE > Subject > OUT_OF_SCOPE
   */
  private resolveGroup(
    sampleLabels: Array<{ name: string; type: string; upvoteCount: number }>
  ): ClassificationGroup {
    // 1. Check REJECT: hard-REJECT with >= 3 upvotes
    const hasReject = sampleLabels.some(
      (l) => l.name === 'REJECT' && l.type === 'hard' && l.upvoteCount >= HARD_REJECT_UPVOTE_THRESHOLD
    );
    if (hasReject) {
      return 'REJECT';
    }

    // 2. Check REWRITE: any rewrite-type label
    const hasRewrite = sampleLabels.some((l) => REWRITE_LABELS.has(l.name));
    if (hasRewrite) {
      return 'REWRITE';
    }

    // 3. Check subject labels (prefer the one with the most upvotes)
    const subjectLabels = sampleLabels
      .filter((l) => SUBJECT_LABELS.has(l.name))
      .sort((a, b) => b.upvoteCount - a.upvoteCount);

    if (subjectLabels.length > 0) {
      return subjectLabels[0].name as ClassificationGroup;
    }

    // 4. Fallback
    return 'OUT_OF_SCOPE';
  }
}
