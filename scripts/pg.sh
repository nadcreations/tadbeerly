#!/usr/bin/env bash
# Start/stop the user-owned development Postgres cluster on port 5435.
# See the README: the system cluster on 5433 needs root to add a login role.
set -euo pipefail

PGROOT="$HOME/.local/share/tadbeerly"
BIN=/usr/lib/postgresql/16/bin

case "${1:-start}" in
  start)
    "$BIN/pg_ctl" start -w -D "$PGROOT/pgdata" -l "$PGROOT/postgres.log" \
      -o "-p 5435 -k $PGROOT"
    pg_isready -h 127.0.0.1 -p 5435
    ;;
  stop)
    "$BIN/pg_ctl" stop -D "$PGROOT/pgdata"
    ;;
  status)
    "$BIN/pg_ctl" status -D "$PGROOT/pgdata"
    ;;
  *)
    echo "usage: $0 [start|stop|status]" >&2
    exit 2
    ;;
esac
