#!/usr/bin/env bash
# npm run test:db: the database tests (test/db/) on a throwaway LOCAL Postgres, never yours. Starts a
# supabase/postgres container (Supabase's roles, pg_cron and pg_net, as in production), migrates it
# with `npm run db:migrate` (DOTENV=0: .env, which may hold the production URL, isn't read), runs the
# tests and removes the container.
#
# Usage: scripts/test-db.sh [<local database URL>]
#   with a URL: an empty local database you started (CI's service container) instead of a new one.
#   The tests empty its tables. Anything that isn't localhost is refused.
set -euo pipefail
cd "$(dirname "$0")/.."
. scripts/lib-local-db.sh

IMAGE=${SUPABASE_IMAGE:-supabase/postgres:17.4.1.054}
container=
cleanup() { [[ -z $container ]] || docker rm -f "$container" >/dev/null 2>&1 || true; }
trap cleanup EXIT

if (($# == 1)); then
  url=$1
else
  container=jw-test-db-$$
  echo "== starting $IMAGE"
  url=$(start_local_db "$container" "$IMAGE")
fi
require_local_db "$url"
wait_for_db "$url"

echo "== npm run db:migrate"
DOTENV=0 SUPABASE_DB_URL=$url npm run --silent db:migrate

echo "== database tests"
# SUPABASE_DB_URL emptied: the tests connect to TEST_DATABASE_URL only
# one file at a time: each test empties the tables
DOTENV=0 SUPABASE_DB_URL= TEST_DATABASE_URL=$url npx vitest run test/db --no-file-parallelism
