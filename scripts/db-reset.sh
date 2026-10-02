#!/usr/bin/env bash
# Wipes the public schema and creates the offers table (supabase/reset.sql).
# Usage: scripts/db-reset.sh        (reads SUPABASE_DB_URL from .env)
set -euo pipefail
. "$(dirname "$0")/lib-db-url.sh"

docker run --rm -i postgres:17-alpine psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 < supabase/reset.sql
