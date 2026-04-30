#!/bin/bash
# EaseMyRentals - Database Backup & Restore
# Usage:
#   ./backup.sh              → create a timestamped backup
#   ./backup.sh restore FILE → restore from a .sql file
set -e

COMPOSE="docker compose -f docker-compose.prod.yml"
BACKUP_DIR="./backups"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)

set -a; source .env 2>/dev/null || true; set +a
DB_USER="${POSTGRES_USER:-easemyrentals}"
DB_NAME="${POSTGRES_DB:-easemyrentals}"

mkdir -p "$BACKUP_DIR"

if [ "$1" = "restore" ]; then
  # ── RESTORE ──────────────────────────────────
  FILE="$2"
  if [ -z "$FILE" ] || [ ! -f "$FILE" ]; then
    echo "ERROR: Provide a valid backup file."
    echo "  Usage: ./backup.sh restore backups/20240101_120000.sql"
    exit 1
  fi
  echo "WARNING: This will OVERWRITE current database with $FILE"
  read -p "Are you sure? (yes/N): " confirm
  [ "$confirm" = "yes" ] || exit 1
  echo ">> Restoring from $FILE..."
  $COMPOSE exec -T db psql -U "$DB_USER" -d "$DB_NAME" < "$FILE"
  echo ">> Restore complete. Restart app to reload data:"
  echo "   $COMPOSE restart app"
else
  # ── BACKUP ──────────────────────────────────
  BACKUP_FILE="$BACKUP_DIR/backup_$TIMESTAMP.sql"
  echo ">> Backing up database to $BACKUP_FILE..."
  $COMPOSE exec -T db pg_dump -U "$DB_USER" "$DB_NAME" > "$BACKUP_FILE"
  SIZE=$(wc -c < "$BACKUP_FILE" | tr -d ' ')
  echo ">> Done! Backup size: ${SIZE} bytes"
  echo ""
  # Keep only last 10 backups
  BACKUP_COUNT=$(ls -1 "$BACKUP_DIR"/*.sql 2>/dev/null | wc -l | tr -d ' ')
  if [ "$BACKUP_COUNT" -gt "10" ]; then
    echo ">> Cleaning old backups (keeping last 10)..."
    ls -1t "$BACKUP_DIR"/*.sql | tail -n +11 | xargs rm -f
  fi
  echo "All backups:"
  ls -lh "$BACKUP_DIR"/*.sql 2>/dev/null || echo "(none)"
fi
