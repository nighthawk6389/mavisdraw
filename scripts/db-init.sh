#!/bin/sh
set -e

echo "Waiting for PostgreSQL to be ready..."
until pg_isready -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" 2>/dev/null; do
  sleep 1
done

echo "Running schema push..."
cd /app/apps/server
pnpm run db:push

echo "Running seed..."
pnpm run db:seed

echo "Database initialization complete."
