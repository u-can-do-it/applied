#!/usr/bin/env bash
# Checks the migrations in drizzle/ against two throwaway LOCAL databases (never production):
#   (a) a database set up the old way is left exactly as it was by `npm run db:migrate`: same
#       schema but the unused functions 0005 drops and the tables added since (0006), same rows
#       (public and cron) but the board seed markers of 0004. "The old way" is either
#         - the old SQL files (supabase/reset.sql, ai-filter.sql, scraping.sql, as scripts/db-reset.sh +
#           db-migrate.sh ran them), then some use: offers, a merged job, an application with its
#           history, a profile and a verdict, scrapers edited and deleted, Supabase Cron connected; or
#         - with --from-dump, a pg_dump of the production `public` schema, restored (see docs/OPERATIONS.md →
#           "Upgrading a database set up before Drizzle"). The closest thing to running it on production.
#       scripts/db-preflight.sql must say PASS everywhere first.
#   (b) an empty database gets, from `npm run db:migrate` alone, the same schema as (a) (with
#       --from-dump the differences are only shown: production may have its own extras); every
#       migration file can run a second time without changing anything; and a view someone built on
#       offers_unique makes the migration fail and roll back, instead of being dropped.
#   (c) lib/db/schema.ts and the migrations agree: drizzle-kit has nothing to generate.
#
# Usage: scripts/db-verify-migrations.sh [--from-dump prod.sql] [<url-a> <url-b>]
#   no URLs: starts two supabase/postgres containers and removes them after
#   two URLs: two empty local databases you started (each its own server: pg_cron lives in the
#   `postgres` database only); anything that isn't localhost is refused
# Needs Docker. The old SQL files are read from git at LEGACY_REF (the last main commit that had
# them), so this needs the full history: in a shallow clone, `git fetch --unshallow` first.
set -euo pipefail
cd "$(dirname "$0")/.."
. scripts/lib-local-db.sh

LEGACY_REF=${LEGACY_REF:-a290945}
IMAGE=${SUPABASE_IMAGE:-supabase/postgres:17.4.1.054}
usage() {
  sed -n '2,24p' "$0" >&2
  exit 1
}

from_dump=
if [[ ${1:-} == --from-dump ]]; then
  from_dump=${2:?"--from-dump needs a file"}
  [[ -r $from_dump ]] || { echo "Can't read $from_dump" >&2 && exit 1; }
  shift 2
fi
(($# == 0 || $# == 2)) || usage
if [[ -z $from_dump ]] && ! git cat-file -e "$LEGACY_REF:supabase/ai-filter.sql" 2>/dev/null; then
  echo "$LEGACY_REF:supabase/ai-filter.sql isn't in this clone's history (shallow clone? git fetch --unshallow)." >&2
  exit 1
fi

# inside the repo: drizzle-kit takes --out relative to it
work=node_modules/.cache/db-verify-$$
mkdir -p "$work"
containers=()
cleanup() {
  ((${#containers[@]})) && docker rm -f "${containers[@]}" >/dev/null 2>&1 || true
  rm -rf "$work"
}
trap cleanup EXIT

if (($# == 2)); then
  url_a=$1 url_b=$2
else
  echo "== starting two $IMAGE containers"
  containers=("jw-verify-a-$$" "jw-verify-b-$$")
  url_a=$(start_local_db "${containers[0]}" "$IMAGE")
  url_b=$(start_local_db "${containers[1]}" "$IMAGE")
fi
require_local_db "$url_a"
require_local_db "$url_b"
wait_for_db "$url_a"
wait_for_db "$url_b"

# what npm run db:migrate runs, without its .env (which may hold the production URL)
migrate() { SUPABASE_DB_URL=$1 node scripts/db-migrate.ts >"$work/migrate.log" 2>&1; }
must_migrate() { migrate "$1" || {
  cat "$work/migrate.log" >&2
  exit 1
}; }
# the whole database's schema, except Drizzle's own bookkeeping; pg_dump's random \restrict key dropped
schema_dump() { pg_tool pg_dump "$1" --schema-only --exclude-schema=drizzle | grep -Ev '^\\(un)?restrict ' >"$2"; }
# the rows: the app's, and Supabase Cron's jobs (pg_dump leaves out cron.job: it belongs to the
# extension, which lives in pg_catalog, so it's read with a query). The tables added since (not there
# in (a) before the migration, empty after it) are left out.
data_dump() {
  local added=()
  for table in ${ADDED_TABLES//|/ }; do added+=("--exclude-table=public.$table"); done
  pg_tool pg_dump "$1" --data-only --schema=public --schema=cron "${added[@]}" | grep -Ev '^\\(un)?restrict ' >"$2"
  pg_tool psql "$1" -X -qtA -c "select jobid, jobname, schedule, command, active, nodename, database, username
    from cron.job order by jobid" >>"$2"
}
# runs SQL from stdin; on failure shows what psql said
run_sql() { psql_file "$1" >"$work/psql.log" 2>&1 || {
  echo "$2 failed:" >&2
  cat "$work/psql.log" >&2
  exit 1
}; }
# reset.sql (or a restored dump) re-created the public schema itself, so the schema's own owner,
# comment, grants and default privileges differ from a fresh database's. Not the migrations' doing:
# those four kinds of entries are left out of the (a)/(b) comparison, and so are pg_dump's comments.
without_public_schema_acl() {
  awk '/^-- Name: / { skip = ($0 ~ /^-- Name: public; Type: SCHEMA;/ || $0 ~ /^-- Name: SCHEMA public; Type: (COMMENT|ACL);/ || $0 ~ /Type: DEFAULT ACL; Schema: public;/) }
       /^--/ || /^$/ { next }
       !skip { print }' "$1" >"$2"
}
# 0005_drop_unused_functions drops these (the app's queries for them are in TypeScript): the one
# change db:migrate makes to an existing database's schema. For the (a) comparison each pg_dump entry
# becomes one line (its statements joined by " ↵ "), the dropped functions' entries are left out and
# the rest sorted: without those functions pg_dump may put the same entries in another order.
DROPPED_FUNCTIONS='jw_set_application_status|jw_ghost_stale_applications|jw_scrape_lock|jw_source_counts|ai_results|ai_pending|ai_range_stats'
# tables a later migration adds (0006_push_subscriptions): new in (a), so their entries are left out
# of the comparison too, and checked to be there
ADDED_TABLES='push_subscriptions'
entries_without_dropped_functions() {
  awk -v names="$DROPPED_FUNCTIONS" -v tables="$ADDED_TABLES" '
    function flush() { if (entry != "" && !skip) print entry; entry = "" }
    /^-- Name: / {
      flush()
      skip = ($0 ~ ("^-- Name: (FUNCTION )?(" names ")\\(")) || ($0 ~ ("^-- Name: (TABLE )?(" tables ")[ ;]"))
      next
    }
    # comments, blank lines, and the SETs pg_dump puts before whichever entry comes before the first table
    /^--/ || /^$/ || /^SET default_table/ { next }
    { entry = entry $0 " ↵ " }
    END { flush() }' "$1" | LC_ALL=C sort >"$2"
}
seed_rows() {
  # config is left out: the seeds' URLs were updated after LEGACY_REF
  pg_tool psql "$1" -X -qtA -c 'select position, name, src, kind, enabled from public.scrapers order by position' \
    -c 'select settings from public.scrape_settings' -c 'select * from public.scrape_state' \
    -c "select name from public.scrape_seeds where name not like 'board:%' order by name" >"$2"
}
# 0004_board_seeds marks the boards seeded so far (lib/db/seed.ts seeds any other one after the
# migrations): the one change db:migrate makes to an existing database's rows
board_markers() { pg_tool psql "$1" -X -qtA -c "select name from public.scrape_seeds where name like 'board:%' order by name" >"$2"; }
same() {
  if diff -u "$2" "$3" >"$work/diff"; then
    echo "   ok: $1"
  else
    echo "   FAILED: $1" >&2
    head -80 "$work/diff" >&2
    exit 1
  fi
}
preflight() { pg_tool psql "$1" -X -q -v ON_ERROR_STOP=1 <scripts/db-preflight.sql | grep -E 'PASS|FAIL' || true; }

if [[ -n $from_dump ]]; then
  echo "== (a) the restored dump ($from_dump), then db:migrate"
  # what the dump expects outside `public`: the extensions its functions and generated column use
  run_sql "$url_a" "preparing for the dump" <<'SQL'
drop schema if exists public cascade;
create schema if not exists extensions;
create extension if not exists unaccent with schema extensions;
create extension if not exists pg_trgm with schema extensions;
create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;
SQL
  run_sql "$url_a" "restoring $from_dump" <"$from_dump"
else
  echo "== (a) old SQL files ($LEGACY_REF) and some use, then db:migrate"
  for file in reset.sql ai-filter.sql scraping.sql; do
    git show "$LEGACY_REF:supabase/$file" | run_sql "$url_a" "supabase/$file"
  done
  seed_rows "$url_a" "$work/a-seeds.txt"
  run_sql "$url_a" "using the app" <<'SQL'
insert into public.offers (src, id, title, company, seniority, remote, url, first_seen) values
  ('justjoin', 'acme-react', 'Senior React Developer (k/m)', 'ACME Sp. z o.o.', 'senior', true,
   'https://justjoin.it/job-offer/acme-react', now() - interval '3 days'),
  ('nofluff', 'acme-frontend', 'Senior Front-end Engineer', 'ACME', 'senior', false,
   'https://nofluffjobs.com/pl/job/acme-frontend', now() - interval '2 days'),
  ('solidjobs', '123', 'React Developer', 'Other', null, null,
   'https://solid.jobs/o/123/jobwatch', now() - interval '1 day');
insert into public.job_links (dup_key, job_key)
  select b.dup_key, a.dup_key from public.offers a, public.offers b where a.id = 'acme-react' and b.id = 'acme-frontend';
insert into public.ai_dup_pairs (key_a, key_b, same, reason, model)
  select least(a.dup_key, b.dup_key), greatest(a.dup_key, b.dup_key), true, 'same job', 'gpt-6-luna'
  from public.offers a, public.offers b where a.id = 'acme-react' and b.id = 'acme-frontend';
insert into public.offer_details (src, id, description, status) values ('justjoin', 'acme-react', 'The whole ad', 'ok');
insert into public.applications (dup_key, src, id, title, company, url, content, details, content_status, history, note)
  select dup_key, src, id, title, company, url, 'The whole ad', '{"salary": "30k"}', 'ok',
         jsonb_build_array(jsonb_build_object('stage', 'submitted', 'state', 'pending', 'at', now() - interval '2 days')),
         'Recruiter: Ann'
  from public.offers where id = 'acme-react';
select public.jw_set_application_status((select dup_key from public.applications), 'invited', 'passed');
insert into public.ai_profiles (name, prompt, file_name, file_text) values ('Me', 'React, remote', 'cv.pdf', 'CV text');
insert into public.ai_verdicts (profile_id, version, dup_key, match, score, summary, checks, had_description)
  select p.id, 1, o.dup_key, true, 80, 'Fits', '[{"item": "React", "met": true}]', true
  from public.ai_profiles p, public.offers o where o.id = 'acme-react';
insert into public.ai_runs (profile_id, version, label, status, total, done, phase, finished_at)
  select id, 1, 'today', 'done', 2, 2, 'assess', now() from public.ai_profiles;
insert into public.scrape_runs (trigger, found, kept, added, fresh, notified, matched) values ('cron', 40, 12, 3, 2, 1, 1);
insert into public.notify_queue (src, id, title, url, dup_key)
  select src, id, title, url, dup_key from public.offers where id = '123';
update public.scrapers set enabled = false, config = config || '{"checkKeyword": true}' where kind = 'bulldog';
update public.scrapers set name = 'JustJoin – Kraków', config = config || '{"checkLocation": false}' where kind = 'justjoin';
delete from public.scrapers where kind = 'eldorado';
delete from public.scrapers where name = 'LinkedIn – remote';
update public.scrape_settings set settings = settings || '{"keywords": ["React", "TypeScript"], "everyMinutes": 15}';
update public.scrape_state set muted = true, last_run_at = now();
select public.jw_cron_connect('http://127.0.0.1:9/x', 's', '*/5 * * * *', false);
SQL
fi
preflight "$url_a" >"$work/preflight.txt"
cat "$work/preflight.txt" | sed 's/^/   preflight: /'
if grep -q FAIL "$work/preflight.txt"; then
  echo "   FAILED: scripts/db-preflight.sql" >&2
  exit 1
fi
schema_dump "$url_a" "$work/a-before.sql"
data_dump "$url_a" "$work/a-before-data.sql"
must_migrate "$url_a"
schema_dump "$url_a" "$work/a-after.sql"
data_dump "$url_a" "$work/a-after-data.sql"
entries_without_dropped_functions "$work/a-before.sql" "$work/a-before-kept.sql"
entries_without_dropped_functions "$work/a-after.sql" "$work/a-after-kept.sql"
same "schema unchanged but for the unused functions 0005 drops and the new tables ($(wc -l <"$work/a-before.sql") lines of pg_dump)" \
  "$work/a-before-kept.sql" "$work/a-after-kept.sql"
if grep -Eq "^CREATE FUNCTION public\.($DROPPED_FUNCTIONS)\(" "$work/a-after.sql"; then
  echo "   FAILED: an unused function is still there after db:migrate" >&2
  exit 1
fi
echo "   ok: the unused functions are gone"
for table in ${ADDED_TABLES//|/ }; do
  grep -q "^CREATE TABLE public\.$table " "$work/a-after.sql" ||
    { echo "   FAILED: db:migrate didn't add public.$table" >&2 && exit 1; }
done
echo "   ok: the new tables are there (${ADDED_TABLES//|/, })"
grep -v '^board:' "$work/a-after-data.sql" >"$work/a-after-rows.sql" || true
same "rows unchanged but for the board seed markers ($(grep -c . "$work/a-before-data.sql") lines of public data + $(grep -c '^[0-9]*|' "$work/a-before-data.sql") cron jobs)" \
  "$work/a-before-data.sql" "$work/a-after-rows.sql"
applied=$(pg_tool psql "$url_a" -X -qtAc 'select count(*) from drizzle.__drizzle_migrations')
echo "   ok: $applied migrations recorded in drizzle.__drizzle_migrations"

echo "== (b) empty database, db:migrate alone"
must_migrate "$url_b"
schema_dump "$url_b" "$work/b.sql"
without_public_schema_acl "$work/a-after.sql" "$work/a-objects.sql"
without_public_schema_acl "$work/b.sql" "$work/b-objects.sql"
if [[ -n $from_dump ]]; then
  if diff -u "$work/a-objects.sql" "$work/b-objects.sql" >"$work/diff"; then
    echo "   ok: schema equal to the restored dump's, but for the public schema's own grants"
  else
    echo "   note: the restored dump differs from a fresh database (- dump, + fresh); not a failure:"
    head -60 "$work/diff" | sed 's/^/      /'
  fi
else
  same "schema equal to (a), but for the public schema's own grants" "$work/a-objects.sql" "$work/b-objects.sql"
  seed_rows "$url_b" "$work/b-seeds.txt"
  same "seed rows equal to the old files'" "$work/a-seeds.txt" "$work/b-seeds.txt"
fi
board_markers "$url_a" "$work/a-markers.txt"
board_markers "$url_b" "$work/b-markers.txt"
[[ -s $work/b-markers.txt ]] || { echo "   FAILED: no board seed markers after db:migrate" >&2 && exit 1; }
same "board seed markers equal ($(wc -l <"$work/b-markers.txt") boards)" "$work/a-markers.txt" "$work/b-markers.txt"
for file in drizzle/[0-9]*.sql; do run_sql "$url_b" "$file (second run)" <"$file"; done
schema_dump "$url_b" "$work/b-again.sql"
same "every migration file runs a second time without changing the schema" "$work/b.sql" "$work/b-again.sql"

# someone's own view on offers_unique: the preflight flags it, and migrating fails and rolls back
run_sql "$url_b" "a view on offers_unique" <<'SQL'
create view public.my_jobs as select dup_key, title from public.offers_unique;
drop schema drizzle cascade; -- so every migration runs again
SQL
preflight "$url_b" | grep -q 'FAIL.*nothing else depends on offers_unique.*my_jobs' ||
  { echo "   FAILED: the preflight didn't flag public.my_jobs" >&2 && exit 1; }
echo "   ok: the preflight flags a view built on offers_unique"
schema_dump "$url_b" "$work/b-with-view.sql"
if migrate "$url_b"; then
  echo "   FAILED: db:migrate dropped or ignored public.my_jobs instead of failing" >&2
  exit 1
fi
grep -q 'cannot drop view offers_unique because other objects depend on it' "$work/migrate.log" ||
  { cat "$work/migrate.log" >&2 && exit 1; }
schema_dump "$url_b" "$work/b-after-failure.sql"
same "...and db:migrate fails on it, says why, and rolls everything back" "$work/b-with-view.sql" "$work/b-after-failure.sql"

echo "== (c) lib/db/schema.ts against the migrations"
cp -r drizzle "$work/drizzle"
npx drizzle-kit generate --dialect=postgresql --schema=./lib/db/schema.ts --out="$work/drizzle" >"$work/generate.log" 2>&1 || {
  cat "$work/generate.log" >&2
  exit 1
}
if grep -q 'No schema changes' "$work/generate.log"; then
  echo "   ok: drizzle-kit generate: no schema changes"
else
  echo "   FAILED: drizzle-kit generate would write a migration:" >&2
  cat "$work/generate.log" >&2
  exit 1
fi
npx drizzle-kit check --dialect=postgresql --out=drizzle >"$work/check.log" 2>&1 || {
  cat "$work/check.log" >&2
  exit 1
}
echo "   ok: drizzle-kit check"

echo "All good."
