#!/bin/sh
set -e

echo "[start-prod] Running Prisma migrations..."
npx prisma migrate deploy --schema prisma/schema.prisma

echo "[start-prod] Starting server..."
exec node dist/main.js
