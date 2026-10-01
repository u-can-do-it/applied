#!/usr/bin/env bash
# Wipes the public schema and creates the offers table (supabase/reset.sql).
# Usage: scripts/db-reset.sh        (reads SUPABASE_DB_URL from .env)
set -euo pipefail
cd "$(dirname "$0")/.."
set -a; . ./.env; set +a

if [[ -z "${SUPABASE_DB_URL:-}" && -t 0 ]]; then
  echo "Supabase → Connect → Session pooler URI, with [YOUR-PASSWORD] replaced by the DB password."
  read -rsp "Paste it here (hidden), then Enter: " SUPABASE_DB_URL
  echo
fi
if [[ -z "${SUPABASE_DB_URL:-}" ]]; then
  echo "SUPABASE_DB_URL is empty in $(pwd)/.env"
  echo "Paste the Session pooler URI from Supabase → Connect between the quotes on that line, save, and rerun."
  exit 1
fi
if [[ "$SUPABASE_DB_URL" != postgres://* && "$SUPABASE_DB_URL" != postgresql://* ]]; then
  echo "SUPABASE_DB_URL must start with postgresql:// (got something starting with '${SUPABASE_DB_URL%%//*}//')."
  echo "That's not the https:// project URL - it's Supabase → Connect → Connection string → Session pooler."
  exit 1
fi
if [[ "$SUPABASE_DB_URL" == *"@db."*".supabase.co"* ]]; then
  echo "That's the Direct connection string (db.<ref>.supabase.co) - it's IPv6-only and this machine has no IPv6."
  echo "Use Supabase → Connect → Connection string → Method: Session pooler (host ends in pooler.supabase.com)."
  exit 1
fi
if [[ "$SUPABASE_DB_URL" == *"…"* ]]; then
  echo "SUPABASE_DB_URL still has a '…' placeholder in it - copy the full string from Supabase → Connect."
  exit 1
fi
if [[ "$SUPABASE_DB_URL" == *"[YOUR-PASSWORD]"* ]]; then
  echo "SUPABASE_DB_URL still contains [YOUR-PASSWORD] — replace it (brackets included) with the database password."
  exit 1
fi

# Supabase requires SSL; without this psql retries in plain text and prints a second, misleading error
[[ "$SUPABASE_DB_URL" == *sslmode=* ]] || SUPABASE_DB_URL+=$([[ "$SUPABASE_DB_URL" == *\?* ]] && echo '&' || echo '?')sslmode=require

docker run --rm -i postgres:17-alpine psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 < supabase/reset.sql
