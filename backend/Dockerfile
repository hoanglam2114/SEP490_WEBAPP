# Sử dụng Node.js image
FROM node:20-alpine

# Thiết lập thư mục làm việc
WORKDIR /app

# Copy package.json và package-lock.json
COPY package*.json ./

# Cài đặt dependencies
RUN npm install --legacy-peer-deps

# Copy toàn bộ mã nguồn
COPY . .

# Build TypeScript
RUN npm run build

# Mở cổng 3000
EXPOSE 3000

# Chạy ứng dụng
CMD ["npm", "start"]
