#!/usr/bin/env bash
# ============================================================
# secrets-setup.sh — Tạo Docker Swarm Secrets trên server GPU
#
# Chạy 1 lần duy nhất trên server production:
#   chmod +x secrets-setup.sh
#   ./secrets-setup.sh
#
# Script sẽ hỏi từng giá trị và KHÔNG lưu ra file nào.
# ============================================================

set -euo pipefail

echo "============================================"
echo "🔐 Thiết lập Docker Swarm Secrets"
echo "============================================"
echo ""

# Hàm tạo secret (xóa cũ nếu đã tồn tại)
create_secret() {
  local name="$1"
  local value="$2"
  if docker secret inspect "${name}" &>/dev/null; then
    echo "⚠️  Secret '${name}' đã tồn tại — bỏ qua."
    echo "   (Nếu muốn cập nhật: docker service update --secret-rm ${name} ... rồi tạo lại)"
  else
    printf "%s" "${value}" | docker secret create "${name}" -
    echo "✅ Đã tạo secret: ${name}"
  fi
}

# Đảm bảo Swarm đã được init
if ! docker info --format '{{.Swarm.LocalNodeState}}' 2>/dev/null | grep -q "active"; then
  echo "⚠️  Docker Swarm chưa active. Đang khởi tạo..."
  docker swarm init
fi

echo ""
echo "Nhập các giá trị bên dưới (input ẩn, không hiển thị):"
echo ""

# ANTHROPIC_API_KEY
read -rsp "🔑 ANTHROPIC_API_KEY (sk-ant-...): " ANTHROPIC_API_KEY
echo ""
create_secret "ANTHROPIC_API_KEY" "${ANTHROPIC_API_KEY}"

# HF_TOKEN
read -rsp "🤗 HF_TOKEN (hf_...): " HF_TOKEN
echo ""
create_secret "HF_TOKEN" "${HF_TOKEN}"

# BACKEND_URL
read -rp "🌐 BACKEND_URL (vd: http://192.168.1.100:3000): " BACKEND_URL
create_secret "BACKEND_URL" "${BACKEND_URL}"

echo ""
echo "============================================"
echo "✅ Hoàn thành! Secrets đã tạo:"
docker secret ls
echo ""
echo "▶️  Deploy service:"
echo "   docker stack deploy -c docker-stack.yml sep490-gpu"
echo "============================================"
