#!/bin/sh
set -e

echo "⏳ Applying database migrations..."
npx prisma migrate deploy

# Seed only when explicitly requested (SEED=true), so restarts don't duplicate data.
if [ "$SEED" = "true" ]; then
  echo "🌱 Seeding database..."
  npx prisma db seed || echo "Seed skipped/failed (continuing)."
fi

echo "🚀 Starting CRM server..."
exec node dist/main
