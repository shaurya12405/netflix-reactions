#!/usr/bin/env bash
# Runs the database tests (supabase/tests/database/*.test.sql) against a
# throwaway local PostgreSQL with a minimal Supabase stand-in
# (tests/db/supabase-shim.sql). No Docker needed.
#
# Needs: PostgreSQL 15+ server binaries, the pgTAP extension and pg_prove.
#   Ubuntu/Debian: sudo apt-get install postgresql postgresql-16-pgtap libtap-parser-sourcehandler-pgtap-perl
#
# Alternative with Docker and the Supabase CLI: `npx supabase start` then
# `npx supabase test db` runs the same test files against a real local Supabase.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PGBIN="${PGBIN:-$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1)}"
if [[ -z "$PGBIN" || ! -x "$PGBIN/initdb" ]]; then
  echo "PostgreSQL server binaries not found. Set PGBIN=/path/to/postgresql/bin" >&2
  exit 1
fi

WORK="$(mktemp -d)"
RUN=()
if [[ "$(id -u)" == "0" ]]; then
  # initdb refuses to run as root; use the postgres system user.
  chown postgres "$WORK"
  RUN=(runuser -u postgres --)
fi

cleanup() {
  "${RUN[@]}" "$PGBIN/pg_ctl" -D "$WORK/data" -m immediate stop >/dev/null 2>&1 || true
  rm -rf "$WORK"
}
trap cleanup EXIT

"${RUN[@]}" "$PGBIN/initdb" -D "$WORK/data" -U postgres -A trust --no-sync >/dev/null
"${RUN[@]}" "$PGBIN/pg_ctl" -D "$WORK/data" -l "$WORK/postgres.log" -w \
  -o "-k $WORK -c listen_addresses='' -c fsync=off" start >/dev/null

export PGHOST="$WORK" PGUSER=postgres PGDATABASE=scenetalk
"${RUN[@]}" "$PGBIN/createdb" -h "$WORK" -U postgres scenetalk
psql_q() { "${RUN[@]}" psql -h "$WORK" -U postgres -d scenetalk -v ON_ERROR_STOP=1 -q "$@"; }

psql_q -c 'alter database scenetalk set search_path = "$user", public, extensions'
psql_q -f "$ROOT/tests/db/supabase-shim.sql"
for migration in "$ROOT"/supabase/migrations/*.sql; do
  echo "migrate: $(basename "$migration")"
  psql_q -f "$migration"
done

echo
"${RUN[@]}" pg_prove -h "$WORK" -U postgres -d scenetalk "$@" "$ROOT"/supabase/tests/database/*.test.sql
