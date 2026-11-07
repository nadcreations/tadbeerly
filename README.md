# Tadbeerly

Tadbeerly is a help desk web app: requests, routing, SLAs and self-service,
built with Next.js, Drizzle, Postgres and Tailwind.

## Getting started

```bash
npm install
bash scripts/pg.sh start      # user-owned Postgres on port 5435
cp .env.example .env.local    # then set SESSION_SECRET (openssl rand -hex 32)
npm run dev
```

<details>
<summary>Recreating the dev cluster from scratch</summary>

```bash
PGROOT=~/.local/share/tadbeerly
mkdir -p "$PGROOT" && printf 'tadbeerly_dev' > "$PGROOT/pwfile" && chmod 600 "$PGROOT/pwfile"
/usr/lib/postgresql/16/bin/initdb -D "$PGROOT/pgdata" -U "$USER" \
  --auth-local=trust --auth-host=scram-sha-256 --pwfile="$PGROOT/pwfile" \
  --encoding=UTF8 --locale=C.UTF-8
rm "$PGROOT/pwfile"
# start it, then:
psql -w -h 127.0.0.1 -p 5435 -U "$USER" -d postgres \
  -c "CREATE DATABASE tadbeerly;" -c "CREATE DATABASE tadbeerly_test;"
```
</details>
