# Из одного файла собираются два образа:
#   docker build --target test -t connect-four-test .   тесты (так же в CI)
#   docker build -t connect-four .                      рабочий образ (последний этап, берётся по умолчанию)
FROM node:22-alpine AS base
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY package.json package-lock.json ./
RUN npm ci
COPY . .

FROM base AS test
CMD ["npm", "test"]

FROM base AS build
RUN npm run build && rm -rf .next/cache

FROM node:22-alpine AS app
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 DATA_DIR=/app/data
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --chown=node:node --from=build /app/.next ./.next
COPY next.config.mjs ws-server.mjs ./
# Папка данных создаётся здесь, чтобы том Docker наследовал права пользователя node
RUN mkdir -p /app/data && chown node:node /app/data
USER node
EXPOSE 3000 3002
# Веб-приложение. WebSocket-сервер запускается из этого же образа: node ws-server.mjs (см. docker-compose.yml)
CMD ["node_modules/.bin/next", "start", "-H", "0.0.0.0"]
