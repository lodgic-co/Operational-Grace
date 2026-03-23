#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."
export $(cat .env.test.local | xargs)

pnpm run ci
