import mongoose from 'mongoose';
import { Label } from '../../../models/Label';
import { DatasetVersion } from '../../../models/DatasetVersion';
import { ProcessedDatasetItem } from '../../../models/ProcessedDatasetItem';
import { DatasetSampleAssignment } from '../../../models/DatasetSampleAssignment';
import { DatasetAssignmentSubmission } from '../../../models/DatasetAssignmentSubmission';
import { ILlmProvider } from '../../../services/providers/ILlmProvider';

export const USER_MESSAGE_LABELS = [
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

export const ASSISTANT_MESSAGE_LABELS = [
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

type MessageRole = 'user' | 'assistant';

export type MessageAutoLabelInput = {
  messageIndex: number;
  role: MessageRole;
  content: string;
};

export type MessageAutoLabelSuggestion = {
  messageIndex: number;
  role: MessageRole;
  label: string[];
  confidence?: number;
  is_correct_logic?: boolean;
};

type MessageAutoLabelSaveSuggestion = Omit<MessageAutoLabelSuggestion, 'label'> & {
  label: string[] | string;
};

type BatchSampleInput = {
  sampleId: string;
  messages: MessageAutoLabelInput[];
};

type BatchSampleResult = {
  sampleId: string;
  status: 'success' | 'failed' | 'skipped';
  insertedCount: number;
  suggestionCount: number;
  error?: string;
};

const USER_LABEL_SET = new Set<string>(USER_MESSAGE_LABELS);
const ASSISTANT_LABEL_SET = new Set<string>(ASSISTANT_MESSAGE_LABELS);

function compactText(value: unknown, maxChars = 1200): string {
  const text = String(value || '').trim();
  if (text.length <= maxChars) return text;
  return `${text.slice(0, Math.floor(maxChars * 0.65))}\n...[truncated]...\n${text.slice(-Math.floor(maxChars * 0.35))}`;
}

function normalizeMessages(messages: MessageAutoLabelInput[]): MessageAutoLabelInput[] {
  if (!Array.isArray(messages)) {
    return [];
  }

  return messages
    .map((message) => ({
      messageIndex: Number(message?.messageIndex),
      role: message?.role,
      content: compactText(message?.content),
    }))
    .filter((message): message is MessageAutoLabelInput => {
      return (
        Number.isInteger(message.messageIndex) &&
        message.messageIndex >= 0 &&
        (message.role === 'user' || message.role === 'assistant') &&
        Boolean(message.content.trim())
      );
    })
    .sort((a, b) => a.messageIndex - b.messageIndex);
}

function validLabelForRole(role: MessageRole, label: unknown): string | null {
  const normalized = String(label || '').trim().toUpperCase();
  if (role === 'user') {
    return USER_LABEL_SET.has(normalized) ? normalized : null;
  }
  return ASSISTANT_LABEL_SET.has(normalized) ? normalized : null;
}

function validLabelsForRole(role: MessageRole, label: unknown): string[] {
  const rawLabels = Array.isArray(label) ? label : [label];
  const seen = new Set<string>();
  const labels: string[] = [];
  rawLabels.forEach((item) => {
    const valid = validLabelForRole(role, item);
    if (valid && !seen.has(valid)) {
      seen.add(valid);
      labels.push(valid);
    }
  });
  return labels;
}

function fallbackLabels(role: MessageRole): string[] {
  return [role === 'user' ? 'WAIT_READY' : 'WAITING'];
}

function clampConcurrency(value: unknown, fallback = 4, max = 8): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    return fallback;
  }
  return Math.min(parsed, max);
}

function buildPrompt(messages: MessageAutoLabelInput[]): string {
  const payload = messages.map((message) => ({
    messageIndex: message.messageIndex,
    role: message.role,
    content: message.content,
  }));

  return `Bạn là chuyên gia phân tích hội thoại gia sư AI theo mô hình Flipped Classroom và phương pháp Socratic. Nhiệm vụ của bạn là gán nhãn (label) cho từng tin nhắn để đánh giá tính chuẩn xác sư phạm.

DỰA TRÊN FILE CẤU HÌNH, ĐỊNH NGHĨA CÁC NHÃN NHƯ SAU:

NHÃN CHO USER (STUDENT INTENT):

CORRECT: Học sinh đưa ra đáp án đúng cho bài tập hiện tại.

INCORRECT: Học sinh đưa ra đáp án sai hoặc logic có lỗ hổng.

REQUEST_HINT: Học sinh yêu cầu gợi ý hoặc than "bí", không biết làm tiếp thế nào.

ASK_THEORY: Câu hỏi về khái niệm, định nghĩa, công thức hoặc đổi đơn vị (ví dụ: "Diện tích là gì?", "1km bằng bao nhiêu m?").

REQUEST_EXPLANATION: Câu hỏi về logic (Tại sao lại ra kết quả đó? Các bước giải thế nào?).

REQUEST_SIMPLER: Học sinh chưa hiểu cách giải thích hiện tại, yêu cầu nói dễ hiểu hơn hoặc dùng ví dụ khác.

SKIP_EXERCISE: Yêu cầu bỏ qua bài tập này để làm bài khác hoặc sang phần tiếp theo.

ENCOURAGE: Thể hiện sự nản lòng, mệt mỏi, chán nản (ví dụ: "khó quá", "mệt quá", "không muốn học nữa").

OFF_TOPIC: Nói chuyện phiếm, hỏi về thông tin cá nhân của AI hoặc các chủ đề không liên quan bài học.

NEXT_SECTION: Xác nhận đã sẵn sàng hoặc yêu cầu chuyển sang phần mới/bài mới.

WAIT_READY: Yêu cầu đợi một chút, chưa sẵn sàng để tiếp tục.

NHÃN CHO ASSISTANT (TUTOR ACTION):

PRAISING: Xác nhận đáp án đúng và khen ngợi cụ thể.

SCAFFOLDING: Phản hồi khi HS làm sai. Không cho đáp án, chỉ đưa ra câu hỏi gợi mở hoặc chỉ ra điểm mâu thuẫn để HS tự nhận ra lỗi.

HINTING: Đưa ra gợi ý từng bước (progressive hints), đi từ gợi ý khái quát đến cụ thể.

CONCEPT_CLARIFY: Giải thích ngắn gọn lý thuyết hoặc công thức mà HS đang hỏi.

LOGIC_BREAKDOWN: Phân tích chi tiết từng bước logic để giải quyết vấn đề.

SIMPLIFYING: Sử dụng kỹ thuật ELI5, ẩn dụ hoặc ví dụ thực tế để làm đơn giản hóa vấn đề.

NAVIGATING: Điều hướng luồng bài học (đồng ý bỏ qua bài tập, chuyển sang phần dễ hơn).

MOTIVATING: Thể hiện sự đồng cảm, khích lệ tinh thần học tập (Growth Mindset).

REDIRECTING: Lịch sự dẫn dắt học sinh quay lại chủ đề chính của bài học.

TRANSITIONING: Tóm tắt bài cũ và giới thiệu mục tiêu phần mới.

WAITING: Xác nhận sự chờ đợi theo yêu cầu của học sinh.

DỮ LIỆU HỘI THOẠI:
${JSON.stringify(payload)}

YÊU CẦU ĐẦU RA:

CHỈ trả về JSON array hợp lệ.

Mỗi message phải có đúng 1 object output tương ứng với messageIndex.

Trường "label" phải là một MẢNG (ARRAY) chứa tất cả các nhãn phù hợp. Nếu tin nhắn chứa nhiều ý định hoặc nhiều hành động, hãy liệt kê tất cả.

confidence là số thực từ 0 đến 1.

Với message role assistant, có thể thêm "is_correct_logic": true hoặc false để audit xem phản hồi có đáp ứng đầy đủ intent của học sinh hay không.

Tuyệt đối không thêm trường "reason" hay bất kỳ văn bản giải thích nào ngoài JSON.

ĐỊNH DẠNG:
[
{ "messageIndex": 0, "role": "user", "label": ["REQUEST_SIMPLER", "REQUEST_HINT"], "confidence": 0.9 },
{ "messageIndex": 1, "role": "assistant", "label": ["SIMPLIFYING", "HINTING"], "confidence": 0.85, "is_correct_logic": true }
]`;
}

function parseSuggestions(rawText: string, messages: MessageAutoLabelInput[]): MessageAutoLabelSuggestion[] {
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

  const byIndex = new Map<number, any>();
  parsed.forEach((item) => {
    const messageIndex = Number(item?.messageIndex);
    if (Number.isInteger(messageIndex)) {
      byIndex.set(messageIndex, item);
    }
  });

  return messages.map((message) => {
    const item = byIndex.get(message.messageIndex);
    const role = item?.role === message.role ? message.role : message.role;
    const label = validLabelsForRole(role, item?.label);
    const confidence = Number(item?.confidence);
    const isCorrectLogic = typeof item?.is_correct_logic === 'boolean' ? item.is_correct_logic : undefined;

    return {
      messageIndex: message.messageIndex,
      role,
      label: label.length ? label : fallbackLabels(role),
      confidence: Number.isFinite(confidence) ? Math.min(1, Math.max(0, confidence)) : undefined,
      ...(role === 'assistant' && isCorrectLogic !== undefined ? { is_correct_logic: isCorrectLogic } : {}),
    };
  });
}

export class MessageAutoLabelingService {
  constructor(private readonly provider: ILlmProvider) {}

  async assertAutoLabelAccess(sampleId: string, userId: string) {
    if (!mongoose.Types.ObjectId.isValid(sampleId)) {
      throw Object.assign(new Error('Invalid sampleId.'), { statusCode: 400 });
    }

    const sample = await ProcessedDatasetItem.findById(sampleId).select('datasetVersionId').lean();
    if (!sample?.datasetVersionId) {
      throw Object.assign(new Error('Sample not found.'), { statusCode: 404 });
    }

    const version = await DatasetVersion.findById(sample.datasetVersionId)
      .select('_id ownerId sharedWithUserIds')
      .lean();

    if (!version) {
      throw Object.assign(new Error('Dataset version not found.'), { statusCode: 404 });
    }

    const userOid = new mongoose.Types.ObjectId(userId);
    const isOwner = String(version.ownerId) === String(userId);
    const hasSharedAccess = Array.isArray((version as any).sharedWithUserIds)
      && (version as any).sharedWithUserIds.some((id: any) => String(id) === String(userId));
    const assignmentCount = await DatasetSampleAssignment.countDocuments({ datasetVersionId: version._id });
    const assignedSample = !isOwner && assignmentCount > 0
      ? await DatasetSampleAssignment.findOne({
        datasetVersionId: version._id,
        sampleId: new mongoose.Types.ObjectId(sampleId),
        assigneeId: userOid,
      }).select('_id').lean()
      : null;
    const hasAssignedAccess = Boolean(assignedSample);

    if (!isOwner && !hasSharedAccess && !hasAssignedAccess) {
      throw Object.assign(new Error('Forbidden: only the dataset owner or collaborator can auto-label messages.'), { statusCode: 403 });
    }


    if (!isOwner && assignmentCount > 0) {
      if (!assignedSample) {
        throw Object.assign(new Error('Sample is not assigned to this account.'), { statusCode: 403 });
      }

      const lockedSubmission = await DatasetAssignmentSubmission.findOne({
        datasetVersionId: version._id,
        assigneeId: userOid,
        status: { $in: ['submitted', 'approved'] },
      }).select('status').lean();

      if (lockedSubmission) {
        throw Object.assign(new Error(`Assignment submission is ${lockedSubmission.status}; labels are locked.`), { statusCode: 403 });
      }
    }
  }

  async preview(sampleId: string, userId: string, messages: MessageAutoLabelInput[]): Promise<MessageAutoLabelSuggestion[]> {
    await this.assertAutoLabelAccess(sampleId, userId);
    const normalizedMessages = normalizeMessages(messages);
    if (!normalizedMessages.length) {
      throw Object.assign(new Error('messages is required.'), { statusCode: 400 });
    }

    const rawText = await this.provider.generateContent(buildPrompt(normalizedMessages));
    return parseSuggestions(rawText, normalizedMessages);
  }

  async save(sampleId: string, userId: string, suggestions: MessageAutoLabelSaveSuggestion[], messages: MessageAutoLabelInput[]) {
    await this.assertAutoLabelAccess(sampleId, userId);
    const normalizedMessages = normalizeMessages(messages);
    if (!Array.isArray(suggestions) || !suggestions.length) {
      throw Object.assign(new Error('suggestions is required.'), { statusCode: 400 });
    }

    const docs = await this.buildInsertDocs(sampleId, userId, suggestions, normalizedMessages);

    if (docs.length) {
      await Label.insertMany(docs, { ordered: false });
    }

    return { insertedCount: docs.length };
  }

  private async buildInsertDocs(
    sampleId: string,
    userId: string,
    suggestions: MessageAutoLabelSaveSuggestion[],
    normalizedMessages: MessageAutoLabelInput[],
  ): Promise<any[]> {
    const messageByIndex = new Map(normalizedMessages.map((message) => [message.messageIndex, message]));
    const sampleOid = new mongoose.Types.ObjectId(sampleId);
    const userOid = new mongoose.Types.ObjectId(userId);
    const candidates: Array<{
      key: string;
      name: string;
      messageIndex: number;
      messageRole: MessageRole;
      targetTextSnapshot: string;
    }> = [];
    const seenCandidateKeys = new Set<string>();

    for (const suggestion of suggestions) {
      const messageIndex = Number(suggestion?.messageIndex);
      const message = messageByIndex.get(messageIndex);
      if (!message || suggestion?.role !== message.role) {
        continue;
      }

      const labels = validLabelsForRole(message.role, suggestion?.label);
      for (const label of labels) {
        const key = `${messageIndex}:${message.role}:${label}`;
        if (seenCandidateKeys.has(key)) {
          continue;
        }
        seenCandidateKeys.add(key);
        candidates.push({
          key,
          name: label,
          messageIndex,
          messageRole: message.role,
          targetTextSnapshot: message.content.slice(0, 2000),
        });
      }
    }

    if (!candidates.length) {
      return [];
    }

    const existingLabels = await Label.find({
      sampleId: sampleOid,
      targetScope: 'message',
      type: 'hard',
      $or: candidates.map((candidate) => ({
        messageIndex: candidate.messageIndex,
        messageRole: candidate.messageRole,
        name: candidate.name,
      })),
    })
      .select('messageIndex messageRole name')
      .lean();

    const existingKeys = new Set(
      existingLabels.map((label: any) => `${Number(label.messageIndex)}:${String(label.messageRole)}:${String(label.name).toUpperCase()}`),
    );

    return candidates
      .filter((candidate) => !existingKeys.has(candidate.key))
      .map((candidate) => ({
        sampleId: sampleOid,
        name: candidate.name,
        type: 'hard',
        targetScope: 'message',
        messageIndex: candidate.messageIndex,
        messageRole: candidate.messageRole,
        targetTextSnapshot: candidate.targetTextSnapshot,
        createdBy: userOid,
        upvotes: [userOid],
        downvotes: [],
      }));
  }

  async previewAndSaveBatch(
    userId: string,
    samples: BatchSampleInput[],
    concurrency?: number,
  ): Promise<{
    processedCount: number;
    successCount: number;
    failureCount: number;
    insertedCount: number;
    results: BatchSampleResult[];
  }> {
    if (!Array.isArray(samples) || !samples.length) {
      throw Object.assign(new Error('samples is required.'), { statusCode: 400 });
    }

    const normalizedConcurrency = clampConcurrency(concurrency);
    const results: BatchSampleResult[] = new Array(samples.length);
    let nextIndex = 0;

    const worker = async () => {
      while (true) {
        const jobIndex = nextIndex;
        nextIndex += 1;
        if (jobIndex >= samples.length) {
          return;
        }

        const sample = samples[jobIndex];
        const sampleId = String(sample?.sampleId || '');
        try {
          const normalizedMessages = normalizeMessages(sample?.messages || []);
          if (!sampleId) {
            results[jobIndex] = {
              sampleId,
              status: 'failed',
              insertedCount: 0,
              suggestionCount: 0,
              error: 'sampleId is required.',
            };
            continue;
          }
          if (!normalizedMessages.length) {
            results[jobIndex] = {
              sampleId,
              status: 'skipped',
              insertedCount: 0,
              suggestionCount: 0,
              error: 'This conversation has no messages.',
            };
            continue;
          }

          await this.assertAutoLabelAccess(sampleId, userId);
          const rawText = await this.provider.generateContent(buildPrompt(normalizedMessages));
          const suggestions = parseSuggestions(rawText, normalizedMessages);
          const docs = await this.buildInsertDocs(sampleId, userId, suggestions, normalizedMessages);

          if (docs.length) {
            await Label.insertMany(docs, { ordered: false });
          }

          results[jobIndex] = {
            sampleId,
            status: 'success',
            insertedCount: docs.length,
            suggestionCount: suggestions.reduce((sum, suggestion) => sum + suggestion.label.length, 0),
          };
        } catch (error: any) {
          results[jobIndex] = {
            sampleId,
            status: 'failed',
            insertedCount: 0,
            suggestionCount: 0,
            error: error?.message || 'Batch auto-label failed.',
          };
        }
      }
    };

    await Promise.all(
      Array.from({ length: Math.min(normalizedConcurrency, samples.length) }, () => worker()),
    );

    const processedResults = results.filter(Boolean);
    return {
      processedCount: processedResults.length,
      successCount: processedResults.filter((result) => result.status === 'success').length,
      failureCount: processedResults.filter((result) => result.status === 'failed').length,
      insertedCount: processedResults.reduce((sum, result) => sum + result.insertedCount, 0),
      results: processedResults,
    };
  }
}
