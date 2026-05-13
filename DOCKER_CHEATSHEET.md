# Docker Cheat Sheet — SEP490 Webapp

## Khởi động / Tắt

| Lệnh | Dùng khi nào |
|------|-------------|
| `docker compose up -d` | Bật toàn bộ stack (đã build rồi) |
| `docker compose up -d --build` | Bật + rebuild image (khi sửa code) |
| `docker compose up -d --build gpu-service` | Rebuild + bật riêng 1 service |
| `docker compose stop` | Tạm dừng tất cả (giữ container, giữ data) |
| `docker compose start` | Bật lại sau khi stop |
| `docker compose restart` | Restart tất cả |
| `docker compose restart gpu-service` | Restart riêng 1 service |
| `docker compose down` | Tắt + xóa container & network (giữ data/volume) |
| `docker compose down -v` | Tắt + xóa luôn volume (⚠️ MẤT DATA) |

---

## Xem trạng thái

| Lệnh | Dùng khi nào |
|------|-------------|
| `docker compose ps` | Xem trạng thái tất cả services |
| `docker stats` | Xem CPU/RAM/GPU realtime |
| `docker logs sep490_gpu -f` | Xem log gpu-service realtime (Ctrl+C để thoát) |
| `docker logs sep490_backend -f` | Xem log backend realtime |
| `docker logs sep490_gpu --tail 50` | Xem 50 dòng log cuối |

---

## Secrets (API keys)

| Lệnh | Dùng khi nào |
|------|-------------|
| `.\secrets-setup.ps1` | Lần đầu setup hoặc đổi tất cả secrets |
| `"sk-ant-xxx" \| Out-File secrets\ANTHROPIC_API_KEY -NoNewline -Encoding utf8` | Đổi riêng 1 secret |
| `docker compose restart gpu-service` | Áp dụng secret mới (không cần rebuild) |

---

## Debug / Vào trong container

| Lệnh | Dùng khi nào |
|------|-------------|
| `docker exec -it sep490_gpu bash` | Vào terminal trong gpu-service |
| `docker exec -it sep490_backend sh` | Vào terminal trong backend |
| `docker exec -it sep490_mongo mongosh` | Vào MongoDB shell |

---

## Dọn dẹp

| Lệnh | Dùng khi nào |
|------|-------------|
| `docker rm -f <tên_container>` | Xóa 1 container đang kẹt |
| `docker compose down` | Xóa toàn bộ container (giữ volume) |
| `docker system prune` | Dọn image/cache thừa (giải phóng disk) |
| `docker system prune -a` | Dọn sạch tất cả kể cả image đang dùng (⚠️) |

---

## Build & Push lên Docker Hub

| Lệnh | Dùng khi nào |
|------|-------------|
| `.\gpu-service\build-push.sh` | Build + push image gpu-service lên Hub |
| `.\gpu-service\build-push.sh v1.2.3` | Push với tag version cụ thể |

---

## Workflow thường dùng

**Sáng mở máy lên làm việc:**
```powershell
docker compose up -d
```

**Sửa code backend/frontend, muốn apply:**
```powershell
docker compose up -d --build backend
# hoặc
docker compose up -d --build frontend
```

**Sửa code gpu-service (app.py):**
```powershell
docker compose up -d --build gpu-service
```

**Tối tắt máy:**
```powershell
docker compose stop
```
*(dùng `stop` thay vì `down` để giữ container, sáng `start` lại nhanh hơn)*

**Có lỗi lạ, muốn reset sạch:**
```powershell
docker compose down
docker compose up -d
```
