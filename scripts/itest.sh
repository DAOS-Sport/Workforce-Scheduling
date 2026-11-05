#!/usr/bin/env bash
# Run the *.itest.ts suite against a throwaway PostgreSQL that lives only for this run.
# Usage: bash scripts/itest.sh [extra vitest args]
# Env: PG_BIN (directory holding initdb/pg_ctl/postgres), ITEST_PORT (default: random 55000-59999).
set -euo pipefail
cd "$(dirname "$0")/.."

# Never inherit a connection target from the caller's shell.
unset DATABASE_URL TEST_DATABASE_URL PGHOST PGHOSTADDR PGPORT PGUSER PGPASSWORD PGPASSFILE PGDATABASE PGSERVICE PGSERVICEFILE PGOPTIONS PGSSLMODE REPLIT_DEPLOYMENT

if [ -z "${PG_BIN:-}" ]; then
  if [ -x /d/daos-pg-runtime-20261005/bin/initdb.exe ]; then
    PG_BIN=/d/daos-pg-runtime-20261005/bin
  elif command -v initdb >/dev/null 2>&1; then
    PG_BIN=$(dirname "$(command -v initdb)")
  else
    echo "itest: initdb not found; set PG_BIN to the PostgreSQL bin directory" >&2
    exit 2
  fi
fi

WORK=$(mktemp -d "${TMPDIR:-/tmp}/itest-pg.XXXXXX")
DATA="$WORK/data"
if command -v cygpath >/dev/null 2>&1; then DATA=$(cygpath -m "$DATA"); fi

cleanup() {
  local status=$?
  if [ -f "$DATA/postmaster.pid" ]; then "$PG_BIN/pg_ctl" -D "$DATA" -m immediate -w stop >/dev/null 2>&1 || true; fi
  rm -rf "$WORK"
  exit "$status"
}
trap cleanup EXIT
trap 'exit 130' INT TERM

"$PG_BIN/initdb" -D "$DATA" -U itest --auth=trust -E UTF8 --locale=C >"$WORK/initdb.log" 2>&1 || { cat "$WORK/initdb.log" >&2; exit 1; }
# Throwaway settings: loopback only, no unix socket, no durability, UTC like production.
cat >>"$DATA/postgresql.conf" <<'CONF'
listen_addresses = '127.0.0.1'
unix_socket_directories = ''
fsync = off
synchronous_commit = off
full_page_writes = off
timezone = 'UTC'
CONF

started=
for attempt in 1 2 3 4 5; do
  PORT=${ITEST_PORT:-$((55000 + RANDOM % 5000))}
  if "$PG_BIN/pg_ctl" -D "$DATA" -l "$WORK/pg.log" -o "-p $PORT" -w -t 60 start >/dev/null 2>&1; then started=1; break; fi
  [ -n "${ITEST_PORT:-}" ] && break
done
[ -n "$started" ] || { echo "itest: postgres failed to start" >&2; tail -20 "$WORK/pg.log" >&2; exit 1; }

node -e '
const { Client } = require("pg");
const c = new Client({ host: "127.0.0.1", port: Number(process.argv[1]), user: "itest", database: "postgres" });
c.connect().then(() => c.query("create database itest")).then(() => c.end()).catch((e) => { console.error(e.message); process.exit(1); });
' "$PORT"

echo "itest: postgres on 127.0.0.1:$PORT, data in $WORK"
TZ=UTC TEST_DATABASE_URL="postgres://itest@127.0.0.1:$PORT/itest" npx vitest run -c vitest.integration.config.ts "$@"
