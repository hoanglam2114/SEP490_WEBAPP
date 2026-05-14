import mongoose from 'mongoose';
import { DatasetVersion } from '../../../models/DatasetVersion';
import { ProcessedDatasetItem } from '../../../models/ProcessedDatasetItem';
import { getEffectiveHardRejectedSampleIdsForVersion, getEffectiveSampleLabelsForVersion } from '../../../services/labelAssignmentService';

/**
 * Subject-only classification groups.
 */
export const CLASSIFICATION_GROUPS = [
  'MATH',
  'PHYSICAL',
  'CHEMISTRY',
  'LITERATURE',
  'BIOLOGY',
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
  hardRejectedCount: number;
  hardRejectedSampleIds: string[];
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
      return {
        totalSamples: 0,
        groups: [],
        sampleClassifications: [],
        hardRejectedCount: 0,
        hardRejectedSampleIds: [],
      };
    }

    const sampleOids = items.map((item: any) => new mongoose.Types.ObjectId(String(item._id)));

    // 2. Load all labels associated with these samples
    const labels = await getEffectiveSampleLabelsForVersion(version._id, sampleOids);

    // 3. Build per-sample label index
    const sampleLabelsMap = new Map<string, Array<{ name: string; type: string; assignedUserCount: number }>>();

    for (const label of labels) {
      const sid = String((label as any).sampleId);
      const entry = {
        name: String((label as any).name || '').toUpperCase(),
        type: String((label as any).type || ''),
        assignedUserCount: Number((label as any).assignedUserCount || 0),
      };
      const list = sampleLabelsMap.get(sid) || [];
      list.push(entry);
      sampleLabelsMap.set(sid, list);
    }

    const hardRejectedItemIds = await getEffectiveHardRejectedSampleIdsForVersion(version._id, sampleOids);
    const hardRejectedSampleIds = items
      .filter((item: any) => hardRejectedItemIds.has(String(item._id)))
      .map((item: any) => String(item.sampleId));

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

    return {
      totalSamples,
      groups,
      sampleClassifications,
      hardRejectedCount: hardRejectedSampleIds.length,
      hardRejectedSampleIds,
    };
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
    hardRejectedCount: number;
    hardRejectedSampleIds: string[];
    items: Array<{ _id: string; sampleId: string; data: Record<string, unknown>; group: ClassificationGroup; hardRejected: boolean }>;
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
    const hardRejectedItemIds = await getEffectiveHardRejectedSampleIdsForVersion(
      version._id,
      items.map((item: any) => new mongoose.Types.ObjectId(String(item._id)))
    );

    const enriched = items.map((item: any) => ({
      _id: String(item._id),
      sampleId: String(item.sampleId),
      data: item.data || {},
      group: groupMap.get(String(item._id)) || ('OUT_OF_SCOPE' as ClassificationGroup),
      hardRejected: hardRejectedItemIds.has(String(item._id)),
    }));

    const filtered = group
      ? enriched.filter((item) => item.group === group.toUpperCase())
      : enriched;

    return {
      totalSamples: classification.totalSamples,
      groups: classification.groups,
      hardRejectedCount: classification.hardRejectedCount,
      hardRejectedSampleIds: classification.hardRejectedSampleIds,
      items: filtered,
    };
  }

  /**
   * Determine the subject classification group for a single sample.
   */
  private resolveGroup(
    sampleLabels: Array<{ name: string; type: string; assignedUserCount: number }>
  ): ClassificationGroup {
    // Prefer the subject label with the highest contributor count.
    const subjectLabels = sampleLabels
      .filter((l) => SUBJECT_LABELS.has(l.name))
      .sort((a, b) => b.assignedUserCount - a.assignedUserCount);

    if (subjectLabels.length > 0) {
      return subjectLabels[0].name as ClassificationGroup;
    }

    // Fallback when no subject label exists.
    return 'OUT_OF_SCOPE';
  }
}
