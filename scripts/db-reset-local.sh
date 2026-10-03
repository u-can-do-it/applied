#!/usr/bin/env bash
# ⚠️ Wipes a LOCAL database's `public` schema (tables, views, functions, data) and Drizzle's record of
# the migrations, then applies every migration again. Refuses anything that isn't localhost.
# Usage: scripts/db-reset-local.sh postgresql://postgres:pg@localhost:5544/postgres
set -euo pipefail
cd "$(dirname "$0")/.."
. scripts/lib-local-db.sh

url=${1:?"Usage: $0 <local database URL>"}
require_local_db "$url"

psql_file "$url" <<'SQL'
drop schema if exists drizzle cascade;
drop schema if exists public cascade;
create schema public;
-- Supabase's default grants on a fresh public schema
grant usage on schema public to postgres, anon, authenticated, service_role;
alter default privileges in schema public grant all on tables    to postgres, anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to postgres, anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to postgres, anon, authenticated, service_role;
SQL

# not npm run db:migrate: that reads .env, which may hold the production URL
SUPABASE_DB_URL=$url node scripts/db-migrate.ts
