import {
  MongoDBMessage,
  Conversation,
  OpenAIFormat,
  AnthropicFormat,
  AlpacaFormat,
  ShareGPTFormat,
  ConversionOptions,
  ConversionResult,
  DataCleaningStats,
} from '../types';

export class ConversionService {
  /**
   * Nhóm messages thành conversations
   */
  groupByConversations(messages: MongoDBMessage[]): Conversation[] {
    const conversationMap = new Map<string, MongoDBMessage[]>();

    messages.forEach((msg) => {
      if (!conversationMap.has(msg.conversation_id)) {
        conversationMap.set(msg.conversation_id, []);
      }
      conversationMap.get(msg.conversation_id)!.push(msg);
    });

    return Array.from(conversationMap.entries()).map(([id, msgs]) => {
      const sortedMsgs = msgs.sort(
        (a, b) =>
          new Date(a.created_at.$date).getTime() -
          new Date(b.created_at.$date).getTime()
      );

      return {
        conversation_id: id,
        messages: sortedMsgs,
        user_id: msgs[0].user_id,
        start_time: new Date(sortedMsgs[0].created_at.$date),
        end_time: new Date(sortedMsgs[sortedMsgs.length - 1].created_at.$date),
        message_count: sortedMsgs.length,
      };
    });
  }

  /**
   * Lọc conversations theo options
   */
  filterConversations(
    conversations: Conversation[],
    options: ConversionOptions
  ): Conversation[] {
    let filtered = conversations;

    if (options.filterByUser) {
      filtered = filtered.filter((c) => c.user_id === options.filterByUser);
    }

    if (options.filterByConversation) {
      filtered = filtered.filter(
        (c) => c.conversation_id === options.filterByConversation
      );
    }

    if (options.startDate) {
      const startDate = new Date(options.startDate);
      filtered = filtered.filter((c) => c.start_time >= startDate);
    }

    if (options.endDate) {
      const endDate = new Date(options.endDate);
      filtered = filtered.filter((c) => c.end_time <= endDate);
    }

    if (options.maxMessagesPerConversation) {
      filtered = filtered.map((c) => ({
        ...c,
        messages: c.messages.slice(0, options.maxMessagesPerConversation),
      }));
    }

    return filtered;
  }

  /**
   * Xóa <think> tags nếu cần
   */
  cleanContent(content: string, removeThinkTags: boolean): string {
    if (!removeThinkTags) return content;
    let cleaned = content;
    // Xóa <think>
    cleaned = cleaned.replace(/<think>[\s\S]*?<\/think>/gi, '');
    // Xóa mọi dòng chứa <think> (dù ở đâu trong dòng)
    cleaned = cleaned.split('\n').filter(line => !line.match(/<think>/i)).join('\n');
    // Xóa từ "emote" (có thể là trường hoặc text)
    cleaned = cleaned.replace(/emote:?\s*\w*/gi, '');
    // Xóa "unknown error"
    cleaned = cleaned.replace(/unknown error/gi, '');
    // Xóa mọi dòng chứa ENCOURAGE_EXERCISE 
    cleaned = cleaned.split('\n').filter(line => !line.match(/ENCOURAGE_EXERCISE|Status 'ENCOURAGE_EXERCISE'|Lỗi: Status 'ENCOURAGE_EXERCISE'/i)).join('\n');
    // Xóa tất cả emoji unicode
    cleaned = cleaned.replace(/[\p{Emoji}\p{Extended_Pictographic}]/gu, '');
    return cleaned.trim();
  }

  /**
   * Convert sang OpenAI format
   */
  toOpenAIFormat(
    conversations: Conversation[],
    options: ConversionOptions
  ): OpenAIFormat[] {
    return conversations.map((conv) => {
      const messages: OpenAIFormat['messages'] = [];

      if (options.includeSystemPrompt && options.systemPrompt) {
        messages.push({
          role: 'system',
          content: options.systemPrompt,
        });
      }

      conv.messages.forEach((msg) => {
        const content = this.cleanContent(
          msg.content,
          options.removeThinkTags || false
        );

        if (content) {
          messages.push({
            role: msg.role === 'user' ? 'user' : 'assistant',
            content,
          });
        }
      });

      return { messages };
    });
  }

  /**
   * Convert sang Anthropic format
   */
  toAnthropicFormat(
    conversations: Conversation[],
    options: ConversionOptions
  ): AnthropicFormat[] {
    const results: AnthropicFormat[] = [];

    conversations.forEach((conv) => {
      for (let i = 0; i < conv.messages.length - 1; i += 2) {
        const userMsg = conv.messages[i];
        const assistantMsg = conv.messages[i + 1];

        if (
          userMsg &&
          assistantMsg &&
          userMsg.role === 'user' &&
          assistantMsg.role === 'assistant'
        ) {
          const userContent = this.cleanContent(
            userMsg.content,
            options.removeThinkTags || false
          );
          const assistantContent = this.cleanContent(
            assistantMsg.content,
            options.removeThinkTags || false
          );

          if (userContent && assistantContent) {
            results.push({
              prompt: `Human: ${userContent}\n\nAssistant:`,
              completion: ` ${assistantContent}`,
            });
          }
        }
      }
    });

    return results;
  }

  /**
   * Convert sang Alpaca/LLaMA format
   */
  toAlpacaFormat(
    conversations: Conversation[],
    options: ConversionOptions
  ): AlpacaFormat[] {
    const results: AlpacaFormat[] = [];

    conversations.forEach((conv) => {
      for (let i = 0; i < conv.messages.length - 1; i += 2) {
        const userMsg = conv.messages[i];
        const assistantMsg = conv.messages[i + 1];

        if (
          userMsg &&
          assistantMsg &&
          userMsg.role === 'user' &&
          assistantMsg.role === 'assistant'
        ) {
          const instruction = this.cleanContent(
            userMsg.content,
            options.removeThinkTags || false
          );
          const output = this.cleanContent(
            assistantMsg.content,
            options.removeThinkTags || false
          );

          if (instruction && output) {
            results.push({
              instruction,
              input: '',
              output,
            });
          }
        }
      }
    });

    return results;
  }

  /**
   * Convert Lesson Structures sang Alpaca format
   */
  convertLessonToAlpaca(data: any[]): AlpacaFormat[] {
    const alpacaDataset: AlpacaFormat[] = [];

    data.forEach((record) => {
      if (record.lessons && Array.isArray(record.lessons)) {
        record.lessons.forEach((lesson: any) => {
          if (lesson.sections && Array.isArray(lesson.sections)) {
            lesson.sections.forEach((section: any) => {
              if (section.type === 'exercise') {
                const content = section.content || '';
                const answer_text = section.answer_text || section.answer || '';

                if (content && answer_text) {
                  alpacaDataset.push({
                    instruction: content.trim(),
                    input: '',
                    output: answer_text.trim(),
                  });
                }
              }
            });
          }
        });
      }
    });

    return alpacaDataset;
  }

  /**
   * Convert Lesson Structures sang OpenAI messages format
   */
  convertLessonToOpenAI(data: any[], options: ConversionOptions): OpenAIFormat[] {
    const openAIData: OpenAIFormat[] = [];

    data.forEach((record) => {
      if (!record.lessons || !Array.isArray(record.lessons)) {
        return;
      }

      record.lessons.forEach((lesson: any) => {
        if (!lesson.sections || !Array.isArray(lesson.sections)) {
          return;
        }

        lesson.sections.forEach((section: any) => {
          if (section.type !== 'exercise') {
            return;
          }

          const userContent = this.cleanContent(
            String(section.content || ''),
            options.removeThinkTags || false
          );
          const assistantContent = this.cleanContent(
            String(section.answer_text || section.answer || ''),
            options.removeThinkTags || false
          );

          if (!userContent || !assistantContent) {
            return;
          }

          const messages: OpenAIFormat['messages'] = [];

          if (options.includeSystemPrompt && options.systemPrompt) {
            messages.push({
              role: 'system',
              content: options.systemPrompt,
            });
          }

          messages.push({ role: 'user', content: userContent });
          messages.push({ role: 'assistant', content: assistantContent });

          openAIData.push({ messages });
        });
      });
    });

    return openAIData;
  }

  /**
   * Convert sang ShareGPT format
   */
  toShareGPTFormat(
    conversations: Conversation[],
    options: ConversionOptions
  ): ShareGPTFormat[] {
    return conversations.map((conv) => {
      const conversations: ShareGPTFormat['conversations'] = [];

      conv.messages.forEach((msg) => {
        const content = this.cleanContent(
          msg.content,
          options.removeThinkTags || false
        );

        if (content) {
          conversations.push({
            from: msg.role === 'user' ? 'human' : 'gpt',
            value: content,
          });
        }
      });

      return { conversations };
    });
  }


  /**
   * === PIPELINE LÀM SẠCH DỮ LIỆU ALPACA ===
   *
   * Áp dụng theo thứ tự:
   * 1. Normalization  — chuẩn hóa văn bản
   * 2. Boilerplate removal — xóa câu trả lời mẫu của AI
   * 3. Length filtering — lọc theo độ dài
   * 4. Deduplication — loại bỏ bản ghi trùng
   */
  cleanAlpacaData(
    data: AlpacaFormat[],
    options: ConversionOptions
  ): { cleaned: AlpacaFormat[]; stats: DataCleaningStats } {
    const stats: DataCleaningStats = {
      originalCount: data.length,
      removedBoilerplate: 0,
      removedTooShort: 0,
      removedTooLong: 0,
      removedDuplicates: 0,
      finalCount: 0,
    };

    const minInstr = options.minCharsInstruction ?? 10;
    const maxInstr = options.maxCharsInstruction ?? 2000;
    const minOut = options.minCharsOutput ?? 5;
    const maxOut = options.maxCharsOutput ?? 4000;

    // --- BƯỚC 1: NORMALIZATION ---
    // Chuẩn hóa whitespace, xóa kí tự lạ
    let cleaned = data.map((item) => ({
      instruction: this.normalizeText(item.instruction),
      input: this.normalizeText(item.input),
      output: this.normalizeText(item.output),
    }));

    // --- BƯỚC 2: BOILERPLATE REMOVAL ---
    // Các mẫu phổ biến trong câu trả lời AI không có giá trị training
    const BOILERPLATE_PATTERNS = [
      /^(xin lỗi|sorry)[,.]?\s*(tôi|i)\s*(không thể|cannot|can't|am unable)/i,
      /^(là một|as an?)\s*(AI|mô hình|model|language model)/i,
      /^(I|Tôi)\s*(don't|không)\s*(have|có)\s*(access|quyền truy cập)/i,
      /^(I|Tôi)\s*(am|là)\s*(just|chỉ là)\s*(an?|một)\s*(AI|mô hình)/i,
      /tôi không được huấn luyện để/i,
      /i (was|have been) (not |)trained to/i,
      /^(Okay|Được rồi|Sure|Chắc chắn)[!,.]?\s*$/i,
      /^(I understand|Tôi hiểu)[.!]?\s*$/i,
    ];

    if (options.removeBoilerplate !== false) {
      const before = cleaned.length;
      cleaned = cleaned.filter((item) => {
        const isBoilerplateInstruction = BOILERPLATE_PATTERNS.some((r) =>
          r.test(item.instruction)
        );
        const isBoilerplateOutput = BOILERPLATE_PATTERNS.some((r) =>
          r.test(item.output)
        );
        return !isBoilerplateInstruction && !isBoilerplateOutput;
      });
      stats.removedBoilerplate = before - cleaned.length;
    }

    // --- BƯỚC 3: LENGTH FILTERING ---
    const tooShort: AlpacaFormat[] = [];
    const tooLong: AlpacaFormat[] = [];

    cleaned = cleaned.filter((item) => {
      if (
        item.instruction.length < minInstr ||
        item.output.length < minOut
      ) {
        tooShort.push(item);
        return false;
      }
      if (
        item.instruction.length > maxInstr ||
        item.output.length > maxOut
      ) {
        tooLong.push(item);
        return false;
      }
      return true;
    });

    stats.removedTooShort = tooShort.length;
    stats.removedTooLong = tooLong.length;

    // --- BƯỚC 4: DEDUPLICATION ---
    if (options.deduplicate !== false) {
      const before = cleaned.length;
      const seen = new Set<string>();
      cleaned = cleaned.filter((item) => {
        // Dùng prefix 60 ký tự làm key để phát hiện bản ghi gần trùng
        const key = item.instruction.slice(0, 60).toLowerCase().replace(/\s+/g, ' ').trim();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
      stats.removedDuplicates = before - cleaned.length;
    }

    // --- BƯỚC 5: REMOVE EMPTY OUTPUT ---
    if (options.removeEmptyOutput) {
      const before = cleaned.length;
      cleaned = cleaned.filter((item) => item.output.trim().length > 0);
      stats.removedTooShort += before - cleaned.length;
    }

    // --- BƯỚC 6: MIN TURNS ---
    if (options.minTurns && options.minTurns > 1) {
      const before = cleaned.length;
      // Alpaca format luôn là 1 turn (1 cặp QA). Nếu yêu cầu > 1 thì lọc hết.
      cleaned = [];
      stats.removedTooShort += before;
    }

    stats.finalCount = cleaned.length;
    return { cleaned, stats };
  }

  /**
   * === PIPELINE LÀM SẠCH DỮ LIỆU OPENAI ===
   *
   * Áp dụng theo thứ tự:
   * 1. Keywords removal - Xóa bỏ các mẫu dữ liệu bị lỗi chứa từ khóa
   * 2. Length filtering - Lọc theo min/max của <think> và assistant content
   * 3. Deduplication - Loại bỏ bản ghi trùng
   */
  cleanOpenAIData(
    data: OpenAIFormat[],
    options: ConversionOptions
  ): { cleaned: OpenAIFormat[]; stats: DataCleaningStats } {
    const stats: DataCleaningStats = {
      originalCount: data.length,
      removedBoilerplate: 0,
      removedTooShort: 0,
      removedTooLong: 0,
      removedDuplicates: 0,
      finalCount: 0,
    };

    const minThink = options.minCharsThink ?? 10;
    const maxThink = options.maxCharsThink ?? 2000;
    const minAssistant = options.minCharsAssistant ?? 5;
    const maxAssistant = options.maxCharsAssistant ?? 4000;

    let cleaned = [...data];

    // BƯỚC 1: Xóa bỏ mẫu lỗi có chứa keyword
    const ERROR_KEYWORDS = [
      "Unknown error",
      "LLM call failed",
      "Error code:",
      "Không tìm thấy agent",
      "Status",
      "not supported by",
      "__CHUNK__"
    ];

    if (options.removeBoilerplate !== false) {
      const before = cleaned.length;
      cleaned = cleaned.filter((item) => {
        // Trả về false nếu có bất kỳ tin nhắn assistant nào chứa error keyword -> để filter out
        return !item.messages.some(msg => {
          if (msg.role !== 'assistant') return false;
          return ERROR_KEYWORDS.some(keyword => msg.content.includes(keyword));
        });
      });
      stats.removedBoilerplate = before - cleaned.length;
    }

    // BƯỚC 2: Kiểm tra độ dài content và <think>
    const tooShort: OpenAIFormat[] = [];
    const tooLong: OpenAIFormat[] = [];

    cleaned = cleaned.filter((item) => {
      let isValid = true;
      for (const msg of item.messages) {
        if (msg.role === 'assistant') {
          const content = msg.content || '';
          const thinkMatch = content.match(/<think>([\s\S]*?)<\/think>/i);
          const thinkText = thinkMatch ? thinkMatch[1].trim() : '';
          const assistantText = content.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();

          // Condition 1: Assistant text length
          if (assistantText.length < minAssistant) {
            tooShort.push(item);
            isValid = false;
            break;
          }
          if (assistantText.length > maxAssistant) {
            tooLong.push(item);
            isValid = false;
            break;
          }

          // Condition 2: <think> length (minMax check only if think tags exist)
          if (thinkMatch) {
            if (thinkText.length < minThink) {
              tooShort.push(item);
              isValid = false;
              break;
            }
            if (thinkText.length > maxThink) {
              tooLong.push(item);
              isValid = false;
              break;
            }
          }
        }
      }
      return isValid;
    });

    stats.removedTooShort = tooShort.length;
    stats.removedTooLong = tooLong.length;

    // BƯỚC 3: DEDUPLICATION
    if (options.deduplicate !== false) {
      const before = cleaned.length;
      const seen = new Set<string>();
      cleaned = cleaned.filter((item) => {
        const userMessages = item.messages.filter(m => m.role === 'user').map(m => m.content).join(' ');
        const key = userMessages.slice(0, 60).toLowerCase().replace(/\s+/g, ' ').trim();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
      stats.removedDuplicates = before - cleaned.length;
    }

    // BƯỚC 4: REMOVE EMPTY ASSISTANT CONTENT
    if (options.removeEmptyOutput) {
      const before = cleaned.length;
      cleaned = cleaned.filter((item) => {
        return item.messages.some(msg => {
          if (msg.role !== 'assistant') return false;
          const assistantText = msg.content.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
          return assistantText.length > 0;
        });
      });
      stats.removedTooShort += before - cleaned.length;
    }

    // BƯỚC 5: MIN TURNS
    if (options.minTurns && options.minTurns > 1) {
      const before = cleaned.length;
      cleaned = cleaned.filter((item) => {
        // Đếm số cặp QA (User tiếp nối bởi Assistant)
        let pairs = 0;
        for (let i = 0; i < item.messages.length - 1; i++) {
          if (item.messages[i].role === 'user' && item.messages[i+1].role === 'assistant') {
            pairs++;
          }
        }
        return pairs >= (options.minTurns || 1);
      });
      stats.removedTooShort += before - cleaned.length;
    }

    stats.finalCount = cleaned.length;
    return { cleaned, stats };
  }

  /**
   * Chuẩn hóa văn bản:
   * - Gộp các ký tự xuống dòng thừa
   * - Xóa khoảng trắng đầu/cuối
   * - Xóa ký tự đặc biệt vô nghĩa lặp lại
   */
  private normalizeText(text: string): string {
    return text
      .replace(/\r\n/g, '\n')          // Chuẩn hóa line endings
      .replace(/\t/g, ' ')              // Tab → space
      .replace(/[ \t]+/g, ' ')          // Nhiều space → 1 space
      .replace(/\n{3,}/g, '\n\n')       // Tối đa 2 dòng trống liên tiếp
      .replace(/([!?.]){3,}/g, '$1')    // !!!!/???/... → !/?/.
      .trim();
  }

  /**
   * Ước tính số tokens
   */
  estimateTokens(text: string): number {
    // Ước tính đơn giản: 1 token ≈ 4 ký tự (tiếng Việt có thể khác)
    return Math.ceil(text.length / 4);
  }


  /**
   * Convert chính (cho Chat Messages)
   */
  convert(
    messages: MongoDBMessage[],
    options: ConversionOptions
  ): ConversionResult {
    // Nhóm thành conversations
    let conversations = this.groupByConversations(messages);

    // Lọc theo options
    conversations = this.filterConversations(conversations, options);

    let data: any[] = [];
    switch (options.format) {
      case 'openai':
        data = this.toOpenAIFormat(conversations, options);
        break;
      case 'anthropic':
        data = this.toAnthropicFormat(conversations, options);
        break;
      case 'alpaca':
        data = this.toAlpacaFormat(conversations, options);
        break;
      case 'sharegpt':
        data = this.toShareGPTFormat(conversations, options);
        break;
      default:
        data = this.toAlpacaFormat(conversations, options);
    }

    // Tính stats
    const totalMessages = conversations.reduce(
      (sum, c) => sum + c.messages.length,
      0
    );
    const totalText = JSON.stringify(data);
    const totalTokensEstimate = this.estimateTokens(totalText);

    return {
      data,
      format: options.format,
      stats: {
        totalConversations: conversations.length,
        totalMessages,
        totalTokensEstimate,
      },
    };
  }
}