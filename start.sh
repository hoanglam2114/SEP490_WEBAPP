#!/bin/bash
# ============================================================
# SEP490 WEBAPP — Startup Script
# Chạy: chmod +x start.sh && ./start.sh
# ============================================================

set -e

echo "🚀 SEP490 Webapp — Starting up..."

# ── Kiểm tra .env ────────────────────────────────────────────
if [ ! -f ".env" ]; then
  echo ""
  echo "❌ Chưa có file .env!"
  echo "   Chạy lệnh sau để tạo:"
  echo "   cp .env.example .env && nano .env"
  echo ""
  exit 1
fi

# ── Kiểm tra Docker ──────────────────────────────────────────
if ! command -v docker &> /dev/null; then
  echo "❌ Docker chưa được cài đặt. Vui lòng cài Docker trước."
  exit 1
fi

if ! docker info &> /dev/null; then
  echo "❌ Docker daemon chưa chạy. Vui lòng khởi động Docker."
  exit 1
fi

# ── Kiểm tra NVIDIA GPU ──────────────────────────────────────
if ! command -v nvidia-smi &> /dev/null; then
  echo "⚠️  Không tìm thấy NVIDIA GPU. GPU service sẽ chạy ở chế độ CPU (chậm hơn)."
fi

# ── Pull images mới nhất ─────────────────────────────────────
echo ""
echo "📦 Pulling images từ Docker Hub..."
docker compose pull

# ── Khởi động toàn bộ stack ──────────────────────────────────
echo ""
echo "▶️  Khởi động services..."
docker compose up -d

# ── Chờ backend sẵn sàng ────────────────────────────────────
echo ""
echo "⏳ Đợi services khởi động..."
sleep 5

# ── Kết quả ─────────────────────────────────────────────────
echo ""
echo "✅ Hoàn tất! Trạng thái các services:"
docker compose ps

echo ""
echo "🌐 Truy cập webapp tại: http://localhost"
echo "📋 Xem logs: docker compose logs -f"
echo "🛑 Dừng:     docker compose down"
echo ""
