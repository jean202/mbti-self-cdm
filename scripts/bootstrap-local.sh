#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
USE_CLEAN_RESET=false

if [ "${1:-}" = "--clean" ]; then
  USE_CLEAN_RESET=true
  shift
fi

if [ "$#" -gt 0 ]; then
  echo "Usage: bash scripts/bootstrap-local.sh [--clean]" >&2
  exit 1
fi

cd "$ROOT_DIR"

run_step() {
  local label="$1"
  shift

  printf '\n==> %s\n' "$label"
  "$@"
}

ensure_env_file() {
  if [ -f .env ]; then
    return
  fi

  cp .env.example .env
  printf 'Created .env from .env.example\n'
}

ensure_env_file

if [ "$USE_CLEAN_RESET" = true ]; then
  run_step "Resetting local Docker volumes" docker compose down -v --remove-orphans
fi

run_step "Starting local infrastructure" docker compose up -d --wait postgres redis
run_step "Generating Prisma client" npm run prisma:generate

printf '\n==> Applying Prisma migrations\n'
if ! npm run prisma:migrate:deploy; then
  printf '\nPrisma migrations could not be applied to the current local database.\n' >&2
  printf 'If this database predates the checked-in migration history, rerun `npm run bootstrap:local:clean`.\n' >&2
  exit 1
fi

run_step "Seeding demo data" npm run db:seed

printf '\nLocal bootstrap completed.\n'
