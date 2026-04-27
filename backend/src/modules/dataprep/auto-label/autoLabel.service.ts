import mongoose from 'mongoose';
import { Label } from '../../../models/Label';
import { DatasetVersion } from '../../../models/DatasetVersion';
import { ProcessedDatasetItem } from '../../../models/ProcessedDatasetItem';
import { ILlmProvider } from '../../../services/providers/ILlmProvider';

export const SUBJECT_LABELS = ['MATH', 'PHYSICAL', 'CHEMISTRY', 'LITERATURE', 'BIOLOGY', 'OTHER'] as const;
export type SubjectLabel = typeof SUBJECT_LABELS[number];

type ClusterSample = {
  sampleId: string;
  data: Record<string, any>;
};

type ClusterPayload = {
  clusterId: number;
  sampleCount: number;
  samples: ClusterSample[];
};

export type AutoLabelSuggestion = {
  clusterId: number;
  label: SubjectLabel;
  // reason: string;
  sampleCount: number;
};

function isSubjectLabel(value: string): value is SubjectLabel {
  return (SUBJECT_LABELS as readonly string[]).includes(value);
}

function normalizeSubjectLabel(value: unknown): SubjectLabel {
  const raw = String(value || '').trim().toUpperCase();
  if (raw === 'MATH') return 'MATH';
  if (raw === 'PHYSICAL') return 'PHYSICAL';
  if (raw === 'CHEMISTRY') return 'CHEMISTRY';
  if (raw === 'LITERATURE') return 'LITERATURE';
  if (raw === 'BIOLOGY') return 'BIOLOGY';
  if (raw === 'OTHER') return 'OTHER';
  return isSubjectLabel(raw) ? raw : 'OTHER';
}

function shuffle<T>(items: T[]): T[] {
  const next = [...items];
  for (let i = next.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [next[i], next[j]] = [next[j], next[i]];
  }
  return next;
}

function compactText(value: unknown, maxChars = 700): string {
  const text = String(value || '').trim();
  if (text.length <= maxChars) return text;
  return `${text.slice(0, Math.floor(maxChars * 0.7))}\n...[truncated]...\n${text.slice(-Math.floor(maxChars * 0.3))}`;
}

function serializeSample(data: Record<string, any>) {
  if (Array.isArray(data?.messages)) {
    return {
      messages: data.messages
        .filter((msg: any) => msg?.role === 'user' || msg?.role === 'assistant')
        .slice(-8)
        .map((msg: any) => ({
          role: String(msg.role || ''),
          content: compactText(msg.content),
        })),
    };
  }

  return {
    instruction: compactText(data?.instruction),
    input: compactText(data?.input),
    output: compactText(data?.output),
  };
}

function buildPrompt(clusters: ClusterPayload[]) {
  const payload = clusters.map((cluster) => ({
    clusterId: cluster.clusterId,
    sampleCount: cluster.sampleCount,
    samples: cluster.samples.map((sample) => ({
      sampleId: sample.sampleId,
      ...serializeSample(sample.data),
    })),
  }));

  return `Bạn là chuyên gia phân loại dữ liệu giáo dục theo môn học.

Hãy gán đúng MỘT nhãn môn học cho từng cụm dữ liệu. Các nhãn hợp lệ:
- MATH: toán học, số học, đại số, hình học, xác suất, thống kê.
- PHYSICAL: vật lý, cơ học, điện, quang, nhiệt, lực, năng lượng.
- CHEMISTRY: hóa học, chất, phản ứng, phương trình hóa học, mol, nguyên tử.
- LITERATURE: ngữ văn, đọc hiểu, viết văn, tiếng Việt, phân tích tác phẩm.
- BIOLOGY: sinh học, cơ thể sống, tế bào, di truyền, sinh thái.
- OTHER: không thuộc một môn cụ thể, xã giao, lỗi hệ thống, dữ liệu nhiễu, hoặc không đủ thông tin.

DỮ LIỆU CỤM:
${JSON.stringify(payload)}

Yêu cầu output:
- CHỈ trả về JSON array hợp lệ.
- Mỗi object bắt buộc có: clusterId, label.
- label phải là một trong: MATH, PHYSICAL, CHEMISTRY, LITERATURE, BIOLOGY, OTHER.
- Không thêm markdown, không giải thích ngoài JSON.

Định dạng:
[
  { "clusterId": 0, "label": "MATH" }
]`;
}

function parseSuggestions(rawText: string, clusters: ClusterPayload[]): AutoLabelSuggestion[] {
  let parsed: any[] = [];
  try {
    const firstBracket = rawText.indexOf('[');
    const lastBracket = rawText.lastIndexOf(']');
    const jsonText = firstBracket >= 0 && lastBracket > firstBracket
      ? rawText.slice(firstBracket, lastBracket + 1)
      : rawText;
    const value = JSON.parse(jsonText);
    parsed = Array.isArray(value) ? value : [value];
  } catch {
    parsed = [];
  }

  const byCluster = new Map<number, any>();
  parsed.forEach((item) => {
    const clusterId = Number(item?.clusterId);
    if (Number.isFinite(clusterId)) {
      byCluster.set(clusterId, item);
    }
  });

  return clusters.map((cluster) => {
    const item = byCluster.get(cluster.clusterId);
    return {
      clusterId: cluster.clusterId,
      label: normalizeSubjectLabel(item?.label),
      // reason: String(item?.reason || 'Fallback label because AI response was missing or invalid.'),
      sampleCount: cluster.sampleCount,
    };
  });
}

export class AutoLabelingService {
  constructor(private readonly provider: ILlmProvider) { }

  async loadClusters(versionId: string, ownerId: string): Promise<ClusterPayload[]> {
    if (!mongoose.Types.ObjectId.isValid(versionId)) {
      throw Object.assign(new Error('Invalid dataset version id.'), { statusCode: 400 });
    }

    const version = await DatasetVersion.findOne({ _id: versionId, ownerId }).lean();
    if (!version) {
      throw Object.assign(new Error('Dataset version not found.'), { statusCode: 404 });
    }

    const items = await ProcessedDatasetItem.find({ datasetVersionId: version._id }).sort({ createdAt: 1 }).lean();
    const grouped = new Map<number, ClusterSample[]>();

    items.forEach((item: any) => {
      const clusterId = Number(item?.data?.cluster);
      if (!Number.isFinite(clusterId)) return;
      const list = grouped.get(clusterId) || [];
      list.push({ sampleId: String(item._id), data: item.data || {} });
      grouped.set(clusterId, list);
    });

    if (!grouped.size) {
      throw Object.assign(new Error('No clustered samples found. Run K-means clustering before Auto Labeling.'), { statusCode: 400 });
    }

    return Array.from(grouped.entries())
      .sort(([a], [b]) => a - b)
      .map(([clusterId, samples]) => ({
        clusterId,
        sampleCount: samples.length,
        samples: shuffle(samples).slice(0, 5),
      }));
  }

  async preview(versionId: string, ownerId: string): Promise<AutoLabelSuggestion[]> {
    const clusters = await this.loadClusters(versionId, ownerId);
    const rawText = await this.provider.generateContent(buildPrompt(clusters));
    return parseSuggestions(rawText, clusters);
  }

  async save(versionId: string, ownerId: string, labels: Array<{ clusterId: number; label: string }>) {
    if (!Array.isArray(labels) || labels.length === 0) {
      throw Object.assign(new Error('labels is required.'), { statusCode: 400 });
    }

    const clusters = await this.loadClusters(versionId, ownerId);
    const validClusterIds = new Set(clusters.map((cluster) => cluster.clusterId));
    const requestedLabels = labels.map((item) => ({
      clusterId: Number(item.clusterId),
      label: normalizeSubjectLabel(item.label),
    }));

    const invalid = requestedLabels.find((item) => !validClusterIds.has(item.clusterId) || !isSubjectLabel(item.label));
    if (invalid) {
      throw Object.assign(new Error('Invalid cluster label payload.'), { statusCode: 400 });
    }

    const version = await DatasetVersion.findOne({ _id: versionId, ownerId }).lean();
    if (!version) {
      throw Object.assign(new Error('Dataset version not found.'), { statusCode: 404 });
    }

    const subjectNames = [...SUBJECT_LABELS];
    const userOid = new mongoose.Types.ObjectId(ownerId);
    let insertedCount = 0;

    for (const item of requestedLabels) {
      const samples = await ProcessedDatasetItem.find({
        datasetVersionId: version._id,
        'data.cluster': item.clusterId,
      }).select('_id').lean();
      const sampleIds = samples.map((sample: any) => sample._id);
      if (!sampleIds.length) continue;

      await Label.deleteMany({
        sampleId: { $in: sampleIds },
        type: 'hard',
        name: { $in: subjectNames },
        $or: [
          { targetScope: 'sample' },
          { targetScope: { $exists: false } },
          { targetScope: null },
        ],
      });

      const docs = sampleIds.map((sampleId) => ({
        sampleId,
        name: item.label,
        type: 'hard' as const,
        targetScope: 'sample' as const,
        createdBy: userOid,
        upvotes: [userOid],
        downvotes: [],
      }));

      if (docs.length) {
        await Label.insertMany(docs, { ordered: false });
        insertedCount += docs.length;
      }
    }

    return { insertedCount };
  }
}
