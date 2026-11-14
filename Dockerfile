FROM node:22-slim
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev || npm install --omit=dev
COPY . .
RUN npm install --no-save vite @vitejs/plugin-react @tailwindcss/vite tailwindcss && npm run build
ENV NODE_ENV=production DATA_DIR=/data PORT=3000
VOLUME /data
EXPOSE 3000
CMD ["npx","tsx","server.ts"]
