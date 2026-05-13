#!/usr/bin/env bash
# ============================================================
# secrets-setup.sh — Tạo secrets/ cho Docker Compose (non-Swarm)
# Chạy 1 lần trên server trước khi docker compose up:
#   chmod +x secrets-setup.sh && ./secrets-setup.sh
#
# Secrets được lưu vào thư mục secrets/ dưới dạng plain text file.
# Thư mục này đã có trong .gitignore — KHÔNG bao giờ commit lên git.
# ============================================================

set -euo pipefail

mkdir -p secrets

echo "============================================"
echo "🔐 Thiết lập GPU Service Secrets"
echo "============================================"
echo ""

read -rsp "🔑 ANTHROPIC_API_KEY (sk-ant-...): " ANTHROPIC_API_KEY
echo ""
printf "%s" "${ANTHROPIC_API_KEY}" > secrets/ANTHROPIC_API_KEY
echo "✅ secrets/ANTHROPIC_API_KEY đã lưu"

read -rsp "🤗 HF_TOKEN (hf_...): " HF_TOKEN
echo ""
printf "%s" "${HF_TOKEN}" > secrets/HF_TOKEN
echo "✅ secrets/HF_TOKEN đã lưu"

# BACKEND_URL mặc định là service name nội bộ, không cần nhập nếu chạy cùng compose
BACKEND_URL_DEFAULT="http://backend:3000"
read -rp "🌐 BACKEND_URL [${BACKEND_URL_DEFAULT}]: " BACKEND_URL_INPUT
BACKEND_URL="${BACKEND_URL_INPUT:-${BACKEND_URL_DEFAULT}}"
printf "%s" "${BACKEND_URL}" > secrets/BACKEND_URL
echo "✅ secrets/BACKEND_URL = ${BACKEND_URL}"

# Đặt permission an toàn
chmod 600 secrets/*

echo ""
echo "============================================"
echo "✅ Hoàn thành! Giờ chạy:"
echo "   docker compose up -d --build"
echo "============================================"
