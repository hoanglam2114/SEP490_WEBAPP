# SEP490 - AI Chatbot Training & Evaluation Platform

Hệ thống quản lý, huấn luyện (Fine-tuning) và đánh giá các mô hình ngôn ngữ lớn (LLM). Hỗ trợ đóng gói hoàn chỉnh bằng Docker để triển khai dễ dàng.

## Kiến trúc hệ thống

Dự án được chia thành 4 dịch vụ chính:
- **Frontend (React + Vite)**: Giao diện người dùng quản lý dataset, huấn luyện và đánh giá.
- **Backend (Node.js + Express)**: Quản lý API, lưu trữ metadata và kết nối các dịch vụ.
- **GPU Service (Python + Unsloth)**: Dịch vụ chuyên biệt xử lý huấn luyện (Fine-tuning) và Inference sử dụng thư viện Unsloth (tối ưu cho GPU).
- **Database (MongoDB)**: Lưu trữ dữ liệu dataset, lịch sử huấn luyện và kết quả đánh giá.

## Hướng dẫn cài đặt và chạy (Dành cho thầy giáo)

### Yêu cầu hệ thống
- **Docker & Docker Compose**: Đã cài đặt trên máy.
- **Hardware**: Cần có NVIDIA GPU (với NVIDIA Container Toolkit) để chạy dịch vụ GPU Service. Nếu không có GPU, dịch vụ này có thể gặp lỗi khi khởi động.

### Các bước khởi động

1.  **Cấu hình biến môi trường**:
    - Tạo file `.env` tại thư mục gốc (nếu chưa có).
    - Điền đầy đủ các API key cần thiết:
      ```env
      ANTHROPIC_API_KEY=your_key_here
      HF_TOKEN=your_token_here
      NGROK_TOKEN=your_token_here
      # Các key khác nếu cần (OPENAI_API_KEY, GEMINI_API_KEY...)
      ```

2.  **Khởi động bằng Docker Compose**:
    Mở Terminal tại thư mục gốc của dự án và chạy lệnh:
    ```powershell
    docker-compose up --build
    ```

3.  **Truy cập ứng dụng**:
    - **Frontend**: `http://localhost`
    - **Backend API**: `http://localhost:3000`
    - **GPU Service API**: `http://localhost:5000`

## Cách đóng gói để gửi

1.  **Xóa dữ liệu rác**: Đảm bảo đã xóa các thư mục `node_modules`, `dist`, `__pycache__` và các file `.env` (chỉ nên gửi `.env.example`).
2.  **Nén thư mục**: Nén toàn bộ thư mục dự án thành file `.zip`.
3.  **Lưu ý**: Nhắc thầy giáo kiểm tra file `.env` và yêu cầu phần cứng GPU trước khi chạy.

---

## Cấu trúc thư mục chi tiết

```
SEP490_WEBAPP/
├── frontend/          # React + Vite application
├── backend/           # Node.js Express API
├── gpu-service/       # Python Unsloth Service
├── docker-compose.yml # Cấu hình Docker toàn hệ thống
├── .env.example       # File mẫu cấu hình biến môi trường
└── README.md          # Hướng dẫn này
```

