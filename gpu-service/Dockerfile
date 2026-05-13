# ============================================================
# GPU Service — Dockerfile
# Base: PyTorch official image với CUDA 12.1 + cuDNN 8
# ============================================================
FROM pytorch/pytorch:2.2.0-cuda12.1-cudnn8-devel

# Metadata
LABEL maintainer="SEP490 Team"
LABEL description="GPU Fine-tuning & Inference Service (Unsloth + Flask)"

# Tránh interactive prompt khi apt-get
ENV DEBIAN_FRONTEND=noninteractive

# Cài system dependencies
RUN apt-get update && apt-get install -y \
    git \
    git-lfs \
    curl \
    wget \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# --- Bước 1: Cài requirements cơ bản ---
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# --- Bước 2: Cài Unsloth (phụ thuộc CUDA, cần cài sau torch) ---
RUN pip install --no-cache-dir --upgrade torchao
RUN pip install --no-cache-dir \
    "unsloth[colab-new] @ git+https://github.com/unslothai/unsloth.git"

# --- Bước 2b: Sync torchvision với phiên bản torch mà unsloth đã nâng lên ---
RUN pip install --no-cache-dir --upgrade "torchvision>=0.25.0"

# --- Bước 2c: Fix bitsandbytes — pin về 0.43.3 tương thích CUDA 12.1 ---
# bitsandbytes >= 0.44 yêu cầu libnvJitLink.so.13 (chỉ có từ CUDA 12.3+)
# Force-reinstall sau unsloth để tránh bị unsloth nâng lên version mới
RUN pip install --no-cache-dir --force-reinstall "bitsandbytes==0.43.3"

# --- Bước 3: Download NLTK data cần thiết ---
RUN python -c "import nltk; nltk.download('punkt', quiet=True); nltk.download('punkt_tab', quiet=True)"

# --- Bước 4: Copy source code ---
COPY app.py .

# Tạo thư mục cần thiết
RUN mkdir -p /app/dataset_uploads /tmp/checkpoints_

# ============================================================
# Biến môi trường (override lúc docker run hoặc qua .env)
# ============================================================
ENV HOST=0.0.0.0
ENV PORT=5000
ENV BACKEND_URL=""
ENV ANTHROPIC_API_KEY=""
ENV HF_TOKEN=""

# Tắt Torch compile để tránh lỗi trên một số GPU
ENV TORCHDYNAMO_DISABLE=1
ENV CUDA_LAUNCH_BLOCKING=1

# Tăng timeout cho HuggingFace download
ENV HF_HUB_DOWNLOAD_TIMEOUT=120

EXPOSE 5000

# Healthcheck — project backend có thể ping endpoint này
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
    CMD curl -f http://localhost:5000/api/train/status/health || exit 1

CMD ["python", "app.py"]
