# ─── Stage 1: Build ───────────────────────────────────────────────
FROM node:22-alpine AS builder

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY prisma ./prisma
RUN npx prisma generate --schema prisma/schema.prisma

COPY tsconfig*.json ./
COPY src ./src
RUN npm run build

# ─── Stage 2: Production ──────────────────────────────────────────
FROM node:22-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production

COPY package*.json ./

# builder에서 설치된 node_modules 복사 후 devDeps 제거
# (runner에서 npm ci 재실행 시 lockfile 버전 충돌 방지)
COPY --from=builder /app/node_modules ./node_modules
RUN npm prune --omit=dev

# Prisma client (generate된 것) + schema (migrate deploy용)
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/node_modules/@prisma ./node_modules/@prisma
COPY prisma ./prisma

# Compiled app
COPY --from=builder /app/dist ./dist

# Type profile data (read at runtime)
COPY data ./data

# Production start script
COPY scripts/start-prod.sh ./scripts/start-prod.sh
RUN chmod +x ./scripts/start-prod.sh

EXPOSE 3000

CMD ["sh", "scripts/start-prod.sh"]
