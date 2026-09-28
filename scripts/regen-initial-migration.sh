#!/usr/bin/env bash
# Regenerates the drizzle-kit initial schema migration in place (pre-release only; keeps its timestamp
# so hand-written migrations that follow still sort after it).
set -euo pipefail
cd "$(dirname "$0")/.."
name=20260928183222_initial_schema
rm -f "supabase/migrations/${name}.sql"
rm -rf supabase/migrations/meta
pnpm drizzle-kit generate --name initial_schema >/dev/null
generated=$(ls supabase/migrations/*_initial_schema.sql | grep -v "$name" | head -1)
mv "$generated" "supabase/migrations/${name}.sql"
sed -i "s/$(basename "$generated" .sql)/${name}/" supabase/migrations/meta/_journal.json
echo "regenerated ${name}.sql"
