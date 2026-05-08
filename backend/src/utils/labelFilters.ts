import mongoose from 'mongoose';
import { Label } from '../models/Label';
import { QUALITY_AUTO_REJECT_MARKER } from '../modules/dataprep/quality/quality.constants';

/**
 * Returns the Set of `ProcessedDatasetItem._id` strings that are hard-rejected
 * by the community, i.e. they have a Label where:
 *   - name === 'REJECT'  (case-insensitive normalised to upper at write time)
 *   - type === 'hard'    (soft 'reject' labels are intentionally excluded)
 *   - upvotes.length - downvotes.length > 0
 *
 * @param scopedSampleIds  Optional allowlist of ObjectIds to narrow the query.
 *                         Pass undefined / empty array to scan all labels.
 */
export async function getHardRejectedSampleIds(
  scopedSampleIds?: mongoose.Types.ObjectId[]
): Promise<Set<string>> {
  const matchStage: Record<string, any> = {
    name: 'REJECT',
    type: 'hard',
    targetTextSnapshot: { $ne: QUALITY_AUTO_REJECT_MARKER },
    $expr: { $gt: [{ $subtract: [{ $size: '$upvotes' }, { $size: '$downvotes' }] }, 0] },
    $or: [
      { targetScope: 'sample' },
      { targetScope: { $exists: false } },
      { targetScope: null },
    ],
  };

  if (scopedSampleIds && scopedSampleIds.length > 0) {
    matchStage.sampleId = { $in: scopedSampleIds };
  }

  const rejectedLabels = await Label.find(matchStage, { sampleId: 1, _id: 0 }).lean();

  const ids = new Set<string>();
  for (const label of rejectedLabels) {
    ids.add(String((label as any).sampleId));
  }
  return ids;
}
