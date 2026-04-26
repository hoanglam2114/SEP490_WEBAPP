/**
 * Script khởi tạo lần đầu cho API Key Manager.
 *
 * Dùng khi:
 *  1. Tạo MASTER_KEY mới
 *  2. Set PIN lần đầu
 *
 * Chạy: npx tsx src/scripts/setup-apikey.ts
 */

import crypto from 'crypto';
import readline from 'readline';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';

dotenv.config();

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = (q: string): Promise<string> =>
  new Promise((resolve) => rl.question(q, resolve));

async function main() {
  console.log('\n🔑  API Key Manager — Setup\n');

  const envPath = path.resolve(process.cwd(), '.env');
  const envContent = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf-8') : '';

  // ── Bước 1: MASTER_KEY ──────────────────────────────────────────────────
  if (!process.env.MASTER_KEY) {
    console.log('⚠️  Chưa có MASTER_KEY trong .env');
    const generate = await ask('Tạo MASTER_KEY mới? (y/n): ');
    if (generate.trim().toLowerCase() === 'y') {
      const masterKey = crypto.randomBytes(32).toString('hex');
      const newLine = `\nMASTER_KEY=${masterKey}`;

      fs.appendFileSync(envPath, newLine);
      console.log(`✅ MASTER_KEY đã được thêm vào .env`);
      console.log(`   Key: ${masterKey}`);
      console.log('   ⚠️  Sao lưu key này ở nơi an toàn. Mất key = mất toàn bộ API keys!\n');

      // Set vào process.env để dùng ngay bên dưới
      process.env.MASTER_KEY = masterKey;
    } else {
      console.log('❌ Bỏ qua. Thêm MASTER_KEY vào .env thủ công rồi chạy lại.');
      rl.close();
      return;
    }
  } else {
    console.log('✅ MASTER_KEY đã tồn tại trong .env\n');
  }

  // ── Bước 2: Set PIN ─────────────────────────────────────────────────────
  const setPin = await ask('Thiết lập PIN admin ngay bây giờ? (y/n): ');
  if (setPin.trim().toLowerCase() === 'y') {
    const mongoUri = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/sep_training';
    console.log(`\nKết nối MongoDB: ${mongoUri}`);

    // Dynamic import để tránh lỗi khi module chưa sẵn sàng
    const mongoose = await import('mongoose');
    await mongoose.default.connect(mongoUri);
    console.log('✅ Kết nối MongoDB thành công\n');

    const { PinConfig } = await import('../models/PinConfig');
    const existing = await PinConfig.findOne();
    if (existing) {
      console.log('⚠️  PIN đã tồn tại. Dùng endpoint /api/admin/pin/change để đổi PIN.');
    } else {
      let pin = '';
      while (!/^\d{6}$/.test(pin)) {
        pin = await ask('Nhập PIN (6 chữ số): ');
        if (!/^\d{6}$/.test(pin)) console.log('❌ PIN phải là 6 chữ số.');
      }

      const { hashPin } = await import('../services/cryptoService');
      const { hash, salt } = await hashPin(pin);
      await PinConfig.create({ pinHash: hash, pinSalt: salt });
      console.log('✅ PIN đã được thiết lập thành công!');
    }

    await mongoose.default.disconnect();
  }

  console.log('\n🎉 Setup hoàn tất. Khởi động server: npm run dev\n');
  rl.close();
}

main().catch((err) => {
  console.error('❌ Lỗi:', err.message);
  rl.close();
  process.exit(1);
});
