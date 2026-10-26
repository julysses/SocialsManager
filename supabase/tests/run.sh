#!/usr/bin/env bash
# Spins up a throwaway local Postgres, stubs the Supabase pieces (auth, storage, roles),
# applies every migration in order, then runs each supabase/tests/*.test.sql file.
set -euo pipefail
cd "$(dirname "$0")/../.."
PGBIN=${PGBIN:-$(ls -d /usr/lib/postgresql/*/bin | sort -V | tail -1)}
PORT=${PGTEST_PORT:-54329}
DATA=$(mktemp -d)
if [ "$(id -u)" = "0" ]; then
  chown postgres "$DATA"
  RUN() { su postgres -c "$1"; }
else
  RUN() { bash -c "$1"; }
fi
cleanup() { RUN "$PGBIN/pg_ctl -D $DATA -m immediate stop" >/dev/null 2>&1 || true; rm -rf "$DATA"; }
trap cleanup EXIT
RUN "$PGBIN/initdb -D $DATA -A trust -U ${PGTEST_SUPERUSER:-postgres}" >/dev/null
RUN "$PGBIN/pg_ctl -D $DATA -o '-p $PORT -k /tmp' -w start" >/dev/null
PSQL="psql -h /tmp -p $PORT -U ${PGTEST_SUPERUSER:-postgres} -v ON_ERROR_STOP=1 -X -q"
$PSQL -d postgres -c "create database socialos" >/dev/null
DB="$PSQL -d socialos"
$DB -f supabase/tests/00_supabase_stub.sql
for f in supabase/migrations/*.sql; do echo "== apply $f"; $DB -f "$f"; done
status=0
for f in supabase/tests/*.test.sql; do
  echo "== test $f"
  if ! $DB -f "$f"; then status=1; echo "FAILED: $f"; fi
done
[ $status -eq 0 ] && echo "ALL SQL TESTS PASSED"
exit $status
