import mongoose from 'mongoose';
import { Label } from '../models/Label';

/**
 * The upvote threshold that triggers the hard-REJECT filter.
 * A sample whose hard-REJECT label reaches this many upvotes is considered
 * "community-rejected" and hidden from normal pipelines.
 */
const HARD_REJECT_UPVOTE_THRESHOLD = 3;

/**
 * Returns the Set of `ProcessedDatasetItem._id` strings that are hard-rejected
 * by the community, i.e. they have a Label where:
 *   - name === 'REJECT'  (case-insensitive normalised to upper at write time)
 *   - type === 'hard'    (soft 'reject' labels are intentionally excluded)
 *   - upvotes.length >= HARD_REJECT_UPVOTE_THRESHOLD
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
    $expr: { $gte: [{ $size: '$upvotes' }, HARD_REJECT_UPVOTE_THRESHOLD] },
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
