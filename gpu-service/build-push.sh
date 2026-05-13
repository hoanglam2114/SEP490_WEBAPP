#!/usr/bin/env bash
# ============================================================
# build-push.sh — Build & Push image lên Docker Hub
# Usage:
#   ./build-push.sh              # build + push tag :latest
#   ./build-push.sh v1.2.3       # build + push tag :v1.2.3 + :latest
# ============================================================

set -euo pipefail

IMAGE="hoanglam51/sep490-gpu-service"
TAG="${1:-latest}"

echo "============================================"
echo "🐳 Building: ${IMAGE}:${TAG}"
echo "============================================"

# Build với CUDA BuildKit
DOCKER_BUILDKIT=1 docker build \
  --platform linux/amd64 \
  -t "${IMAGE}:${TAG}" \
  -f Dockerfile \
  .

# Nếu TAG không phải latest thì push cả :latest
if [ "${TAG}" != "latest" ]; then
  docker tag "${IMAGE}:${TAG}" "${IMAGE}:latest"
  echo "✅ Tagged thêm :latest"
fi

echo ""
echo "============================================"
echo "📤 Pushing lên Docker Hub..."
echo "============================================"

# Đăng nhập nếu chưa (bỏ qua nếu đã login)
docker login --username hoanglam51 || true

docker push "${IMAGE}:${TAG}"
if [ "${TAG}" != "latest" ]; then
  docker push "${IMAGE}:latest"
fi

echo ""
echo "✅ Done! Image available tại:"
echo "   docker pull ${IMAGE}:${TAG}"
echo ""
echo "▶️  Deploy lên Swarm server:"
echo "   docker stack deploy -c docker-stack.yml sep490-gpu"
