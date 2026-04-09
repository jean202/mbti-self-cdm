#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
USE_CLEAN_RESET=false

if [ "${1:-}" = "--clean" ]; then
  USE_CLEAN_RESET=true
  shift
fi

if [ "$#" -gt 0 ]; then
  echo "Usage: bash scripts/verify-local.sh [--clean]" >&2
  exit 1
fi

cd "$ROOT_DIR"

run_step() {
  local label="$1"
  shift

  printf '\n==> %s\n' "$label"
  "$@"
}

if [ "$USE_CLEAN_RESET" = true ]; then
  run_step "Bootstrapping local stack" bash scripts/bootstrap-local.sh --clean
else
  run_step "Bootstrapping local stack" bash scripts/bootstrap-local.sh
fi

run_step "Type checking" npm run typecheck
run_step "Building app" npm run build
run_step "Running provider verification" node scripts/test-provider-verification.js
run_step "Running MBTI onboarding verification" node scripts/verify-mbti-onboarding.js
run_step "Running calendar OAuth start verification" node scripts/verify-calendar-oauth-start.js
run_step "Running calendar OAuth callback verification" node scripts/verify-calendar-oauth-callback.js
run_step "Running calendar flow verification" node scripts/verify-calendar-flow.js
run_step "Running vertical slice verification" node scripts/verify-vertical-slice.js
run_step "Running auth flow verification" node scripts/verify-auth-flow.js

printf '\nLocal verification completed.\n'
