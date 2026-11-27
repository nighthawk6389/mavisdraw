#!/bin/sh
set -e

echo "Waiting for PostgreSQL to be ready..."
until pg_isready -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" 2>/dev/null; do
  sleep 1
done

echo "Applying migrations..."
cd /app/apps/server
node dist/db/migrate.js

# The compiled seed: the image has no dev tools (tsx), and it refuses to run
# with NODE_ENV=production (it creates a demo account with a known password)
echo "Running seed..."
node dist/db/seed.js

echo "Database initialization complete."
