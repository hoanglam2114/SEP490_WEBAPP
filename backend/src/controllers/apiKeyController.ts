import { Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import {
  listKeys,
  setKey,
  deleteKey,
  toggleKey,
  getAuditLog,
  getKey,
} from '../services/keyManager';
import { decrypt } from '../services/cryptoService';
import { ApiKeyConfig } from '../models/ApiKeyConfig';

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Che giá trị key: hiện 4 ký tự đầu + *** + 4 ký tự cuối */
function maskValue(plain: string): string {
  if (plain.length <= 8) return '****';
  return plain.slice(0, 4) + '·'.repeat(6) + plain.slice(-4);
}

// ─── List ────────────────────────────────────────────────────────────────────

/**
 * GET /api/admin/api-keys
 * Trả danh sách key (giá trị bị mask)
 */
export async function getApiKeys(req: Request, res: Response): Promise<void> {
  try {
    const records = await listKeys();

    const result = records.map((r) => {
      // Giải mã để tạo preview mask — không trả full value
      let maskedValue = '(lỗi giải mã)';
      try {
        const plain = decrypt({
          encryptedValue: r.encryptedValue,
          iv: r.iv,
          authTag: r.authTag,
        });
        maskedValue = maskValue(plain);
      } catch {}

      return {
        name: r.name,
        maskedValue,
        description: r.description,
        isActive: r.isActive,
        createdAt: r.createdAt,
        updatedAt: r.updatedAt,
        lastUsedAt: r.lastUsedAt,
      };
    });

    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
}

// ─── Create / Update ──────────────────────────────────────────────────────────

/**
 * POST /api/admin/api-keys
 * Body: { name, value, description? }
 */
export async function createOrUpdateApiKey(req: Request, res: Response): Promise<void> {
  try {
    const { name, value, description } = req.body;

    if (!name || !value) {
      res.status(400).json({ error: 'name và value là bắt buộc.' });
      return;
    }
    if (!/^[A-Z0-9_]+$/i.test(name)) {
      res.status(400).json({ error: 'Tên key chỉ được chứa chữ cái, số và dấu _.' });
      return;
    }

    const { isNew } = await setKey(name, value, description);
    res.status(isNew ? 201 : 200).json({
      message: isNew ? `Đã tạo key "${name.toUpperCase()}".` : `Đã cập nhật key "${name.toUpperCase()}".`,
      isNew,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
}

// ─── Update description only ─────────────────────────────────────────────────

/**
 * PATCH /api/admin/api-keys/:name/description
 * Body: { description }
 */
export async function updateDescription(req: Request, res: Response): Promise<void> {
  try {
    const name = req.params.name.toUpperCase();
    const { description } = req.body;

    const record = await ApiKeyConfig.findOne({ name });
    if (!record) {
      res.status(404).json({ error: `Key "${name}" không tồn tại.` });
      return;
    }

    await ApiKeyConfig.updateOne({ name }, { description });
    res.json({ message: `Đã cập nhật mô tả cho "${name}".` });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
}

// ─── Delete ──────────────────────────────────────────────────────────────────

/**
 * DELETE /api/admin/api-keys/:name
 */
export async function deleteApiKey(req: Request, res: Response): Promise<void> {
  try {
    const name = req.params.name.toUpperCase();
    const record = await ApiKeyConfig.findOne({ name });
    if (!record) {
      res.status(404).json({ error: `Key "${name}" không tồn tại.` });
      return;
    }

    await deleteKey(name);
    res.json({ message: `Đã xoá key "${name}".` });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
}

// ─── Toggle active ───────────────────────────────────────────────────────────

/**
 * PATCH /api/admin/api-keys/:name/toggle
 */
export async function toggleApiKey(req: Request, res: Response): Promise<void> {
  try {
    const name = req.params.name.toUpperCase();
    const newStatus = await toggleKey(name);
    res.json({
      message: `Key "${name}" đã được ${newStatus ? 'kích hoạt' : 'vô hiệu hoá'}.`,
      isActive: newStatus,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
}

// ─── Import: parse file (chưa lưu) ───────────────────────────────────────────

/**
 * POST /api/admin/api-keys/import/parse
 * Multipart: file (.env | .xlsx | .xls | .csv)
 * Trả về mảng { name, value } để frontend review từng cặp
 */
export async function parseImportFile(req: Request, res: Response): Promise<void> {
  try {
    if (!req.file) {
      res.status(400).json({ error: 'Không tìm thấy file upload.' });
      return;
    }

    const filePath = req.file.path;
    const originalName = req.file.originalname.toLowerCase();
    let pairs: { name: string; value: string }[] = [];

    // ── .env ──────────────────────────────────────────────────────────────────
    if (originalName.endsWith('.env') || originalName === '.env') {
      const content = fs.readFileSync(filePath, 'utf-8');
      pairs = parseDotEnv(content);
    }
    // ── Excel (.xlsx / .xls) ─────────────────────────────────────────────────
    else if (originalName.endsWith('.xlsx') || originalName.endsWith('.xls')) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const XLSX = require('xlsx');
        const wb = XLSX.readFile(filePath);
        const ws = wb.Sheets[wb.SheetNames[0]];
        const rows: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1 });

        // Bỏ dòng header nếu dòng đầu là ["name","value"] hoặc ["key","value"] (case-insensitive)
        let startRow = 0;
        if (rows[0]) {
          const first = rows[0].map((c: any) => String(c).toLowerCase().trim());
          if (
            (first[0] === 'name' || first[0] === 'key') &&
            first[1] === 'value'
          ) {
            startRow = 1;
          }
        }

        pairs = rows
          .slice(startRow)
          .filter((row) => row[0] && row[1] !== undefined && row[1] !== null && row[1] !== '')
          .map((row) => ({ name: String(row[0]).trim(), value: String(row[1]).trim() }));
      } catch (xlsxErr: any) {
        res.status(500).json({
          error: 'Không thể đọc file Excel. Đảm bảo đã cài package "xlsx": npm install xlsx',
        });
        return;
      }
    }
    // ── CSV ───────────────────────────────────────────────────────────────────
    else if (originalName.endsWith('.csv')) {
      const content = fs.readFileSync(filePath, 'utf-8');
      pairs = parseCsv(content);
    } else {
      res.status(400).json({ error: 'Chỉ hỗ trợ file .env, .xlsx, .xls, .csv.' });
      return;
    }

    // Dọn file tạm
    fs.unlink(filePath, () => {});

    // Kiểm tra key nào đã tồn tại
    const existingNames = new Set(
      (await ApiKeyConfig.find({}, 'name')).map((r) => r.name)
    );

    const enriched = pairs.map((p) => ({
      name: p.name.toUpperCase(),
      value: p.value,
      alreadyExists: existingNames.has(p.name.toUpperCase()),
    }));

    res.json({ count: enriched.length, items: enriched });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
}

// ─── Audit log ───────────────────────────────────────────────────────────────

/**
 * GET /api/admin/api-keys/audit-log?limit=100
 */
export async function getAuditLogHandler(req: Request, res: Response): Promise<void> {
  try {
    const limit = Math.min(Number(req.query.limit) || 100, 500);
    const logs = await getAuditLog(limit);
    res.json(logs);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
}

// ─── Parsers ─────────────────────────────────────────────────────────────────

function parseDotEnv(content: string): { name: string; value: string }[] {
  const result: { name: string; value: string }[] = [];
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const eqIndex = trimmed.indexOf('=');
    if (eqIndex === -1) continue;

    const name = trimmed.slice(0, eqIndex).trim();
    let value = trimmed.slice(eqIndex + 1).trim();

    // Bỏ dấu nháy bao quanh nếu có
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    if (name) result.push({ name, value });
  }
  return result;
}

function parseCsv(content: string): { name: string; value: string }[] {
  const lines = content.split('\n').map((l) => l.trim()).filter(Boolean);
  const result: { name: string; value: string }[] = [];

  // Kiểm tra header
  let startIndex = 0;
  if (lines[0]) {
    const first = lines[0].toLowerCase();
    if (first.startsWith('name,') || first.startsWith('key,')) {
      startIndex = 1;
    }
  }

  for (const line of lines.slice(startIndex)) {
    const parts = line.split(',');
    if (parts.length < 2) continue;
    const name = parts[0].trim().replace(/^["']|["']$/g, '');
    const value = parts.slice(1).join(',').trim().replace(/^["']|["']$/g, '');
    if (name && value) result.push({ name, value });
  }
  return result;
}
