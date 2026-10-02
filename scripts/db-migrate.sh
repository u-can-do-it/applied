#!/usr/bin/env bash
# Applies migrations to Supabase. Safe to re-run: every file only adds what's missing.
# Usage: scripts/db-migrate.sh                 (supabase/ai-filter.sql, then supabase/scraping.sql)
#        scripts/db-migrate.sh some/other.sql  (any file)
set -euo pipefail
. "$(dirname "$0")/lib-db-url.sh"

files=("$@")
[[ ${#files[@]} -gt 0 ]] || files=(supabase/ai-filter.sql supabase/scraping.sql)
for f in "${files[@]}"; do
  echo "== $f"
  docker run --rm -i postgres:17-alpine psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -q < "$f"
done
echo "done."
