# ---- Build stage: 编译前端 ----
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

# ---- Runtime stage: 生产运行 ----
FROM node:20-alpine
RUN apk add --no-cache tini
WORKDIR /app

COPY --from=builder /app/package*.json ./
RUN npm ci --omit=dev
COPY --from=builder /app/public ./public
COPY --from=builder /app/server ./server
COPY --from=builder /app/shared ./shared
COPY --from=builder /app/.env.example .env.example

RUN mkdir -p /app/data && chown -R node:node /app/data
USER node
VOLUME ["/app/data"]
EXPOSE 5174
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "server/index.js"]
