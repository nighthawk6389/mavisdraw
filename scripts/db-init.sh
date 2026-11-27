#!/bin/sh
set -e

echo "Waiting for PostgreSQL to be ready..."
until pg_isready -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" 2>/dev/null; do
  sleep 1
done

echo "Applying migrations..."
cd /app/apps/server
node dist/db/migrate.js

echo "Running seed..."
pnpm run db:seed

echo "Database initialization complete."
