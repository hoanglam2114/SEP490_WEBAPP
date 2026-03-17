# Chatbot Finetuning Data Converter

Giải pháp web để convert dữ liệu chat từ MongoDB sang các format phổ biến cho finetuning chatbot.

## Tính năng

- Upload file JSON từ MongoDB
- Convert sang nhiều format:
  - **OpenAI Format** (JSONL): Cho GPT-3.5/GPT-4 finetuning
  - **Anthropic Format** (JSONL): Cho Claude finetuning
  - **LLaMA/Alpaca Format** (JSON): Cho các mô hình open-source
  - **ShareGPT Format** (JSON): Format phổ biến cho nhiều công cụ
- Xem trước dữ liệu trước khi download
- Lọc theo conversation, user, date range
- Thống kê tổng quan về dữ liệu

## Tech Stack

### Frontend
- TypeScript
- React + Vite
- TailwindCSS
- React Query
- Zustand (state management)

### Backend
- Node.js + Express
- TypeScript
- Multer (file upload)
- MongoDB (optional - để lưu history)

## Cấu trúc thư mục

```
chatbot-data-converter/
├── frontend/
│   ├── src/
│   │   ├── components/
│   │   ├── services/
│   │   ├── types/
│   │   └── utils/
│   ├── package.json
│   └── tsconfig.json
├── backend/
│   ├── src/
│   │   ├── controllers/
│   │   ├── services/
│   │   ├── types/
│   │   └── utils/
│   ├── package.json
│   └── tsconfig.json
└── README.md
```

## Cài đặt

### Backend
```bash
cd backend
npm install
npm run dev
```

### Frontend
```bash
cd frontend
npm install
npm run dev
```

## API Endpoints

- `POST /api/upload` - Upload file JSON
- `POST /api/convert` - Convert dữ liệu sang format mong muốn
- `GET /api/stats/:fileId` - Lấy thống kê về file
- `GET /api/preview/:fileId` - Xem trước dữ liệu

## Format Output

### 1. OpenAI Format
```jsonl
{"messages": [{"role": "user", "content": "..."}, {"role": "assistant", "content": "..."}]}
```

### 2. Anthropic Format
```jsonl
{"prompt": "Human: ...\n\nAssistant:", "completion": "..."}
```

### 3. LLaMA/Alpaca Format
```json
[{"instruction": "...", "input": "", "output": "..."}]
```

### 4. ShareGPT Format
```json
[{"conversations": [{"from": "human", "value": "..."}, {"from": "gpt", "value": "..."}]}]
```
