# Sử dụng base image có sẵn CUDA và cuDNN từ NVIDIA
FROM nvidia/cuda:12.1.1-devel-ubuntu22.04

# Tránh các câu hỏi tương tác trong quá trình cài đặt
ENV DEBIAN_FRONTEND=noninteractive

# Cài đặt Python và các dependencies hệ thống
RUN apt-get update && apt-get install -y \
    python3.10 \
    python3-pip \
    git \
    wget \
    && rm -rf /var/lib/apt/lists/*

# Nâng cấp pip
RUN python3 -m pip install --upgrade pip

# Thiết lập thư mục làm việc
WORKDIR /app

# Copy file requirements.txt trước để tận dụng Docker cache
COPY requirements.txt .

# Cài đặt các thư viện Python cơ bản
RUN pip3 install --no-cache-dir -r requirements.txt

# Cài đặt Unsloth và các thư viện liên quan
# Loại bỏ [colab-new] vì đang chạy trong Docker không phải Colab
RUN pip3 install --no-cache-dir "unsloth @ git+https://github.com/unslothai/unsloth.git"
RUN pip3 install --no-cache-dir --no-deps "xformers<0.0.29" "trl<0.9.0" peft accelerate bitsandbytes

# Copy toàn bộ mã nguồn vào container
COPY . .

# Cấp quyền thực thi cho entrypoint
RUN chmod +x entrypoint.sh

# Mở cổng cho Flask
EXPOSE 5000

# Chạy service thông qua entrypoint
ENTRYPOINT ["./entrypoint.sh"]
