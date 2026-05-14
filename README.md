# SEP490 – Hướng dẫn chạy hệ thống

## Yêu cầu

- Máy tính có **GPU NVIDIA** (tối thiểu 8GB VRAM)
- Đã cài **Docker Desktop** (Windows/Mac) hoặc **Docker Engine** (Linux)
- Đã cài **NVIDIA Container Toolkit** (để Docker nhận GPU)

> Nếu chưa cài Docker: https://docs.docker.com/get-docker/  
> Nếu chưa cài NVIDIA Container Toolkit: https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/install-guide.html

---

## Các bước chạy

### Bước 1 — Clone repo

```bash
git clone https://github.com/hoanglam2114/SEP490-PROJECT.git
cd SEP490-PROJECT
```

### Bước 2 — Tạo file cấu hình

Đặt file `.env` (được gửi kèm) vào **thư mục gốc** của repo (cùng cấp với file `docker-compose.yml`):

```
SEP490-PROJECT/
├── docker-compose.yml
├── .env          ← đặt file này vào đây
├── start.sh
└── ...
```

### Bước 3 — Khởi động hệ thống

**Trên Linux/Mac:**
```bash
chmod +x start.sh
./start.sh
```

**Trên Windows (PowerShell):**
```powershell
docker compose pull
docker compose up -d
```

### Bước 4 — Truy cập webapp

Mở trình duyệt và vào: **http://localhost**

---

## Thông tin cổng kết nối

| Service | Cổng | Mô tả |
|---|---|---|
| Frontend (Nginx) | `80` | Giao diện người dùng |
| Backend (Node.js) | `3000` | API server (nội bộ) |
| GPU Service (Flask) | `5000` | Fine-tune & Inference (nội bộ) |
| MongoDB | `27017` | Database (nội bộ) |

> Backend, GPU Service và MongoDB **không expose ra ngoài** — chỉ giao tiếp nội bộ qua Docker network. Người dùng chỉ cần truy cập port 80.

---

## Xem logs & kiểm tra trạng thái

```bash
# Xem trạng thái tất cả services
docker compose ps

# Xem logs theo thời gian thực
docker compose logs -f

# Xem logs từng service
docker compose logs frontend
docker compose logs backend
docker compose logs gpu-service
```

---

## Dừng hệ thống

```bash
docker compose down
```

---

## Lưu ý quan trọng

**GPU Service mất khoảng 1–2 phút để khởi động** sau khi `docker compose up` do cần load model AI vào bộ nhớ. Trong thời gian này các tính năng fine-tune/inference chưa dùng được, các tính năng còn lại hoạt động bình thường.

**Nếu không có GPU** hệ thống vẫn khởi động được nhưng GPU Service sẽ báo lỗi — các tính năng fine-tune và inference sẽ không hoạt động.

**File `.env` chứa API keys** — không chia sẻ công khai, không commit lên git.

**Lần đầu chạy** sẽ tải images từ Docker Hub (~5–10GB tổng), cần kết nối internet tốt và mất 5–15 phút tùy tốc độ mạng. Các lần sau khởi động trong vài giây.
