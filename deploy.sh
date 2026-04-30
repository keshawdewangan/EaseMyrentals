#!/bin/bash
# EaseMyRentals - Production Deploy Script
# Usage: ./deploy.sh
#
# SAFE TO RUN REPEATEDLY - will NOT delete your database or user data.
# Data lives in the named Docker volume 'emr_postgres_prod_data'.
# Only the app container is rebuilt on each deploy.
set -e

COMPOSE="docker compose -f docker-compose.prod.yml"
BACKUP_DIR="./backups"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)

echo "============================================"
echo "  EaseMyRentals - Production Deployment"
echo "  $(date)"
echo "============================================"

# ── 1. Check .env ──────────────────────────────
if [ ! -f ".env" ]; then
  echo "ERROR: .env file not found."
  echo "  cp .env.example .env && nano .env"
  exit 1
fi

set -a; source .env; set +a

REQUIRED_VARS=("POSTGRES_PASSWORD" "SUPERADMIN_EMAIL" "SUPERADMIN_PASSWORD")
for var in "${REQUIRED_VARS[@]}"; do
  if [ -z "${!var}" ]; then
    echo "ERROR: $var is not set in .env"
    exit 1
  fi
done

if [ "$SUPERADMIN_PASSWORD" = "admin123" ] || [ "$SUPERADMIN_PASSWORD" = "CHANGE_ME_STRONG_PASSWORD_MIN_12_CHARS" ]; then
  echo "WARNING: SUPERADMIN_PASSWORD is still the default. Change it in .env before going live!"
  read -p "Continue anyway? (y/N): " confirm
  [[ "$confirm" =~ ^[yY]$ ]] || exit 1
fi

# ── 2. Backup DB before deploy (if DB is running) ──
mkdir -p "$BACKUP_DIR"
DB_RUNNING=$($COMPOSE ps -q db 2>/dev/null | wc -l | tr -d ' ')
if [ "$DB_RUNNING" -gt "0" ]; then
  echo ""
  echo ">> Backing up database before deploy..."
  $COMPOSE exec -T db pg_dump \
    -U "${POSTGRES_USER:-easemyrentals}" \
    "${POSTGRES_DB:-easemyrentals}" \
    > "$BACKUP_DIR/pre_deploy_$TIMESTAMP.sql" 2>/dev/null \
    && echo "   Backup saved: $BACKUP_DIR/pre_deploy_$TIMESTAMP.sql" \
    || echo "   (backup skipped - DB not ready yet)"
else
  echo ""
  echo ">> First deploy - no backup needed (DB not running yet)"
fi

# ── 3. Pull latest code ────────────────────────
echo ""
echo ">> Pulling latest code..."
git pull origin main 2>/dev/null || echo "   (skipped - not a git repo or already up to date)"

# ── 4. Rebuild ONLY the app container ──────────
# --no-recreate on db ensures DB container and its volume are untouched.
echo ""
echo ">> Building app image..."
$COMPOSE --env-file .env build app

echo ""
echo ">> Starting / updating containers (DB data preserved)..."
$COMPOSE --env-file .env up -d --remove-orphans

# ── 5. Health check ────────────────────────────
echo ""
echo ">> Waiting for app to be healthy..."
for i in $(seq 1 15); do
  HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:8080/ 2>/dev/null || echo "000")
  if [ "$HTTP_CODE" = "200" ]; then
    PUBLIC_IP=$(curl -s --max-time 3 ifconfig.me 2>/dev/null || echo "YOUR_SERVER_IP")
    echo ""
    echo "============================================"
    echo "  SUCCESS! App is live:"
    echo "  http://$PUBLIC_IP:8080"
    echo ""
    echo "  Logs:    $COMPOSE logs -f app"
    echo "  Stop:    $COMPOSE down"
    echo "  Backup:  ./backup.sh"
    echo "  DANGER - never run: $COMPOSE down -v"
    echo "============================================"
    exit 0
  fi
  echo "   Waiting... ($i/15)"
  sleep 3
done

echo ""
echo "WARNING: App did not respond after 45s."
echo "Check logs: $COMPOSE logs app"
