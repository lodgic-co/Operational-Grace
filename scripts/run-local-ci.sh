#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."
export $(cat .env.test.local | xargs)

pnpm db:migrate
pnpm typecheck
pnpm lint
pnpm openapi:check
pnpm test
pnpm build
