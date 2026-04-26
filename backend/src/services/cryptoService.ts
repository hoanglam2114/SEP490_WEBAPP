import crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';

/**
 * Lấy MASTER_KEY từ env (32 bytes dạng hex = 64 ký tự).
 * Chạy script `npm run generate-key` để tạo lần đầu.
 */
function getMasterKey(): Buffer {
  const hex = process.env.MASTER_KEY;
  if (!hex || hex.length !== 64) {
    throw new Error(
      'MASTER_KEY không hợp lệ. Chạy: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))" để tạo.'
    );
  }
  return Buffer.from(hex, 'hex');
}

export interface EncryptedPayload {
  encryptedValue: string;
  iv: string;
  authTag: string;
}

/** Mã hoá plaintext bằng AES-256-GCM */
export function encrypt(plaintext: string): EncryptedPayload {
  const key = getMasterKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  const encrypted = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);

  return {
    encryptedValue: encrypted.toString('hex'),
    iv: iv.toString('hex'),
    authTag: cipher.getAuthTag().toString('hex'),
  };
}

/** Giải mã payload từ MongoDB */
export function decrypt(payload: EncryptedPayload): string {
  const key = getMasterKey();
  const decipher = crypto.createDecipheriv(
    ALGORITHM,
    key,
    Buffer.from(payload.iv, 'hex')
  );
  decipher.setAuthTag(Buffer.from(payload.authTag, 'hex'));

  return (
    decipher.update(payload.encryptedValue, 'hex', 'utf8') +
    decipher.final('utf8')
  );
}

/** Hash PIN bằng scrypt (tương đương bcrypt về bảo mật) */
export async function hashPin(pin: string): Promise<{ hash: string; salt: string }> {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = await new Promise<string>((resolve, reject) => {
    crypto.scrypt(pin, salt, 32, (err, derived) => {
      if (err) reject(err);
      else resolve(derived.toString('hex'));
    });
  });
  return { hash, salt };
}

/** Kiểm tra PIN so với hash đã lưu */
export async function verifyPin(pin: string, hash: string, salt: string): Promise<boolean> {
  const derived = await new Promise<Buffer>((resolve, reject) => {
    crypto.scrypt(pin, salt, 32, (err, buf) => {
      if (err) reject(err);
      else resolve(buf);
    });
  });
  return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), derived);
}

/** Tạo session token ngẫu nhiên */
export function generateToken(): string {
  return crypto.randomBytes(32).toString('hex');
}
