# Sourced by the scripts that wipe or rebuild a database. They only ever touch one on this machine:
# production is changed by `npm run db:migrate` alone.
# Run it directly (bash scripts/lib-local-db.sh) to self-test the guard below.

# exits unless $1 is a postgres URL whose only host is localhost, 127.0.0.1 or [::1]
require_local_db() {
  local url=$1 rest authority host
  if [[ $url != postgres://* && $url != postgresql://* ]]; then
    echo "Not a postgresql:// URL: '${url%%//*}//…'" >&2
    exit 1
  fi
  # libpq and postgres.js take hosts from the query string too (?host=, ?hostaddr=, a socket
  # directory), and several hosts separated by commas: any of those could point elsewhere
  if [[ $url == *\?* ]]; then
    echo "Refusing a database URL with a query string (?host= and the like could point elsewhere)." >&2
    exit 1
  fi
  rest=${url#*://}
  authority=${rest%%/*}
  if [[ $authority == *,* ]]; then
    echo "Refusing a database URL with several hosts." >&2
    exit 1
  fi
  host=${authority##*@}
  if [[ $host == \[* ]]; then host=${host%%]*}]; else host=${host%%:*}; fi
  case $host in
    localhost | 127.0.0.1 | '[::1]') ;;
    *)
      echo "Refusing to run against '$host': only a local database (localhost, 127.0.0.1, [::1])." >&2
      exit 1
      ;;
  esac
}

# psql / pg_dump from the postgres:17 image, so nothing needs installing; host network for localhost
PG_IMAGE=${PG_IMAGE:-postgres:17-alpine}
pg_tool() { docker run --rm -i --network host "$PG_IMAGE" "$@"; }
psql_file() { pg_tool psql "$1" -v ON_ERROR_STOP=1 -q -X; }

# starts a throwaway Postgres container ($2: the image) named $1 on a free localhost port; prints its URL.
# Run it in a subshell, $(…), and record the name for cleanup (docker rm -f).
start_local_db() {
  docker run --rm -d --name "$1" -e POSTGRES_PASSWORD=local -p 127.0.0.1::5432 "$2" >/dev/null
  echo "postgresql://postgres:local@localhost:$(docker port "$1" 5432/tcp | head -1 | sed 's/.*://')/postgres"
}

# waits until the database at $1 answers; the supabase/postgres image restarts Postgres once after its
# init scripts, so it must answer twice in a row
wait_for_db() {
  local url=$1 ok=0
  for _ in $(seq 1 90); do
    if pg_tool psql "$url" -X -qtAc 'select 1' >/dev/null 2>&1; then
      ((++ok >= 2)) && return 0
    else
      ok=0
    fi
    sleep 1
  done
  echo "Database at $url did not come up." >&2
  exit 1
}

if [[ ${BASH_SOURCE[0]} == "$0" ]]; then
  set -u
  failed=0
  expect() { # expect accept|refuse <url>
    local got=refuse
    (require_local_db "$2") 2>/dev/null && got=accept
    if [[ $got == "$1" ]]; then echo "ok    $1  $2"; else echo "WRONG $got  $2" && failed=1; fi
  }
  expect accept 'postgresql://postgres:pg@localhost:5544/postgres'
  expect accept 'postgres://u:p%40x@127.0.0.1:5432/x'
  expect accept 'postgresql://u:p@[::1]:5432/x'
  expect accept 'postgresql://localhost/x'
  expect refuse 'postgresql://u:p@aws-0-eu-central-1.pooler.supabase.com:6543/postgres'
  expect refuse 'postgresql://u:p@localhost.example.com:5432/x'
  expect refuse 'postgresql://u:p@localhost:5432/x?host=db.example.com'
  expect refuse 'postgresql://u:p@localhost:5432/x?hostaddr=10.0.0.5'
  expect refuse 'postgresql://u:p@localhost/x?host=/var/run/postgresql'
  expect refuse 'postgresql://u:p@localhost:5432,db.example.com:5432/x'
  expect refuse 'postgresql://u:p@db.example.com:5432,localhost:5432/x'
  expect refuse 'postgresql:///x'
  expect refuse 'https://x.supabase.co'
  exit $failed
fi
