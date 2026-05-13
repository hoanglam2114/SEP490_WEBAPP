# Hướng dẫn Deploy SEP490 trên GPU Server

---

## Yêu cầu máy chủ

- Hệ điều hành: **Ubuntu 22.04** (khuyến nghị)
- GPU: NVIDIA (bất kỳ loại nào có CUDA)
- RAM: tối thiểu 16GB
- Ổ cứng: tối thiểu 100GB trống

---

## Bước 1 — Cài đặt môi trường (chỉ làm 1 lần)

Mở terminal trên server, chạy lần lượt từng lệnh:

### 1.1. Cập nhật hệ thống

```bash
sudo apt-get update && sudo apt-get upgrade -y
```

### 1.2. Cài Docker

```bash
# Tải script cài tự động của Docker
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh

# Cho phép chạy docker không cần sudo
sudo usermod -aG docker $USER

# Áp dụng quyền (quan trọng — phải logout rồi login lại)
newgrp docker
```

Kiểm tra Docker đã cài thành công:
```bash
docker --version
# Phải thấy: Docker version 24.x.x hoặc mới hơn
```

### 1.3. Cài NVIDIA Container Toolkit (để Docker nhận GPU)

```bash
# Thêm repo NVIDIA
curl -fsSL https://nvidia.github.io/libnvidia-container/gpgkey \
  | sudo gpg --dearmor -o /usr/share/keyrings/nvidia-container-toolkit-keyring.gpg

curl -s -L https://nvidia.github.io/libnvidia-container/stable/deb/nvidia-container-toolkit.list \
  | sed 's#deb https://#deb [signed-by=/usr/share/keyrings/nvidia-container-toolkit-keyring.gpg] https://#g' \
  | sudo tee /etc/apt/sources.list.d/nvidia-container-toolkit.list

# Cài
sudo apt-get update
sudo apt-get install -y nvidia-container-toolkit

# Kết nối với Docker
sudo nvidia-ctk runtime configure --runtime=docker
sudo systemctl restart docker
```

Kiểm tra GPU đã nhận:
```bash
docker run --rm --gpus all nvidia/cuda:12.1.1-base-ubuntu22.04 nvidia-smi
# Phải thấy thông tin GPU của máy
```

---

## Bước 2 — Lấy code lên server

### Cách A — Dùng Git (nếu repo đã public hoặc có SSH key)

```bash
git clone https://github.com/<your-org>/SEP490_WEBAPP.git
cd SEP490_WEBAPP
```

### Cách B — Copy thủ công từ máy local lên server

Chạy lệnh này **trên máy Windows của bạn** (thay `user` và `server-ip`):

```powershell
scp -r D:\Project\git\SEP490_WEBAPP user@<server-ip>:~/SEP490_WEBAPP
```

Sau đó trên server:
```bash
cd ~/SEP490_WEBAPP
```

---

## Bước 3 — Tạo file cấu hình bí mật

> Bước này nhập API keys. Input sẽ ẩn, không hiện ra màn hình.

### 3.1. Tạo secrets cho GPU Service

```bash
chmod +x secrets-setup.sh
./secrets-setup.sh
```

Script sẽ hỏi lần lượt:
- `ANTHROPIC_API_KEY` → key Claude (sk-ant-...)
- `HF_TOKEN` → token HuggingFace (hf_...)
- `BACKEND_URL` → nhấn Enter để dùng mặc định `http://backend:3000`

### 3.2. Tạo file `.env` cho Backend

```bash
nano .env
```

Dán nội dung sau vào (thay giá trị thực của bạn), sau đó nhấn `Ctrl+X` → `Y` → `Enter` để lưu:

```env
DEEPSEEK_API_KEY=<key của bạn>
GEMINI_API_KEY=<key của bạn>
GOOGLE_DRIVE_CREDENTIALS=<json credentials>
GOOGLE_DRIVE_FOLDER_ID=<folder id>
OPENAI_API_KEY=<key của bạn>
OPENAI_BASE_URL=https://api.groq.com/openai/v1
OPENAI_MODEL=gpt-oss-120b
```

---

## Bước 4 — Kéo image và chạy

### 4.1. Pull image GPU Service từ Docker Hub

```bash
docker pull hoanglam51/sep490-gpu-service:latest
```

> Lần đầu sẽ mất 5-10 phút tùy tốc độ mạng (~15GB).

### 4.2. Khởi động toàn bộ stack

```bash
docker compose up -d
```

> Lần đầu mất thêm 1-2 phút để GPU load model. Bình thường.

---

## Bước 5 — Kiểm tra đã chạy chưa

```bash
# Xem trạng thái tất cả services
docker compose ps
```

Kết quả bình thường trông như này:

```
NAME                STATUS
sep490_gpu          Up (healthy)
sep490_backend      Up
sep490_frontend     Up
sep490_mongo        Up
sep490_certbot      Up
```

Kiểm tra GPU service đã sẵn sàng:

```bash
docker logs sep490_gpu --tail 20
```

Tìm dòng này ở cuối — có nghĩa là chạy thành công:
```
🔥 Flask Server đang lắng nghe trên 0.0.0.0:5000 ...
```

Kiểm tra website:
```bash
curl http://localhost/health
# Trả về 200 là OK
```

---

## Cập nhật code mới

Khi có phiên bản mới, chỉ cần:

```bash
# Kéo image mới nhất
docker pull hoanglam51/sep490-gpu-service:latest

# Build lại backend/frontend nếu có thay đổi
git pull
docker compose up -d --build

# Hoặc chỉ restart để áp dụng image mới
docker compose up -d
```

---

## Các lệnh thường dùng

| Việc cần làm | Lệnh |
|---|---|
| Xem trạng thái | `docker compose ps` |
| Xem log realtime | `docker logs sep490_gpu -f` |
| Tắt tạm | `docker compose stop` |
| Bật lại | `docker compose start` |
| Reset sạch | `docker compose down && docker compose up -d` |
| Đổi API key | Sửa file `.env` hoặc `secrets/` rồi `docker compose restart backend` hoặc `docker compose restart gpu-service` |

Chi tiết hơn xem file **DOCKER_CHEATSHEET.md**.

---

## Xử lý sự cố thường gặp

**GPU service khởi động chậm (~1-2 phút)**
→ Bình thường. Service đang load model AI. Đợi thêm.

**Lỗi `Cannot connect to the Docker daemon`**
→ Docker chưa chạy. Chạy: `sudo systemctl start docker`

**Lỗi `nvidia-smi` không tìm thấy GPU**
→ Chưa cài NVIDIA driver. Chạy: `sudo ubuntu-drivers autoinstall && sudo reboot`

**Website không truy cập được**
→ Kiểm tra firewall có mở port 80/443 chưa:
```bash
sudo ufw allow 80
sudo ufw allow 443
```

**Hết dung lượng ổ cứng**
→ Dọn Docker cache: `docker system prune -a`
