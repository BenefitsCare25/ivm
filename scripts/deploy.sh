#!/usr/bin/env bash
# Deploy IVM to Azure VM
# Env source of truth: /etc/ivm/.env (never overwritten by deploys)
set -e

# Deploy target: "azure" (default) or "hostinger"
TARGET="${1:-azure}"
FORCE=false
for arg in "$@"; do
  [ "$arg" = "--force" ] && FORCE=true
done

if [ "$TARGET" = "azure" ]; then
  VPS="azureuser@20.198.253.167"
  KEY="$HOME/Downloads/ivm-vm_key.pem"
else
  VPS="root@72.62.75.247"
  KEY="$HOME/.ssh/id_ed25519"
fi

# ── Pre-flight: check for active scrape jobs ──────────────────────────────────
echo "Checking for active scrape jobs..."

# Upload check script first (it needs Prisma client on the server)
scp -i "$KEY" -q scripts/check-active-jobs.js "$VPS":/tmp/check-active-jobs.js

ACTIVE_CHECK=$(ssh -i "$KEY" -o ConnectTimeout=10 "$VPS" "
  cd /var/www/ivm
  source /etc/ivm/.env 2>/dev/null
  cp /tmp/check-active-jobs.js /var/www/ivm/_check.js
  node _check.js
  rm -f _check.js /tmp/check-active-jobs.js
")

RUNNING_SESSIONS=$(echo "$ACTIVE_CHECK" | cut -d'|' -f1 | tr -d '[:space:]')
PROCESSING_ITEMS=$(echo "$ACTIVE_CHECK" | cut -d'|' -f2 | tr -d '[:space:]')

if [ "$RUNNING_SESSIONS" != "0" ] || [ "$PROCESSING_ITEMS" != "0" ]; then
  echo ""
  echo "⚠  ACTIVE SCRAPE JOBS DETECTED"
  echo "   Running sessions:  $RUNNING_SESSIONS"
  echo "   Processing items:  $PROCESSING_ITEMS"
  echo ""
  if [ "$FORCE" = true ]; then
    echo "   --force flag set, deploying anyway..."
  else
    echo "   Deploying now will kill workers and leave items stuck in PROCESSING."
    echo "   Wait for jobs to finish, or run: bash scripts/deploy.sh --force"
    exit 1
  fi
else
  echo "No active jobs. Safe to deploy."
fi

# ── Deploy ────────────────────────────────────────────────────────────────────
echo "Creating tarball..."
tar czf /tmp/ivm-deploy.tar.gz \
  --exclude=node_modules \
  --exclude=.git \
  --exclude=.next \
  --exclude="*.tar.gz" \
  --exclude=.env \
  --exclude=uploads \
  .

echo "Uploading..."
scp -i "$KEY" /tmp/ivm-deploy.tar.gz "$VPS":/tmp/ivm-deploy.tar.gz

echo "Deploying on VPS..."
# MSYS_NO_PATHCONV=1 prevents git bash on Windows from translating Unix paths
# (e.g. /var/www/ivm/public) inside the SSH command string before sending to remote.
MSYS_NO_PATHCONV=1 ssh -i "$KEY" "$VPS" "
  set -e
  cd /var/www/ivm

  # Remove pages that no longer exist locally (tar extract won't delete old files)
  rm -rf src/app/\(dashboard\)/intelligence/document-sets

  # Capture lock hash before extract to detect dependency changes
  OLD_LOCK_HASH=\$(md5sum /var/www/ivm/package-lock.json 2>/dev/null | cut -d' ' -f1 || echo 'none')

  tar xzf /tmp/ivm-deploy.tar.gz

  # Always symlink .env to persistent config — survives every deploy
  ln -sf /etc/ivm/.env /var/www/ivm/.env

  # Verify correct DB config before continuing
  DB_URL=\$(grep '^DATABASE_URL' /etc/ivm/.env | cut -d= -f2- | tr -d '\"')
  if echo \"\$DB_URL\" | grep -q '/ivm_dev'; then
    echo 'ERROR: /etc/ivm/.env has wrong DATABASE_URL (db ivm_dev)'
    echo \"Current: \$DB_URL\"
    exit 1
  fi
  echo \"DB: \$DB_URL\"

  NEW_LOCK_HASH=\$(md5sum /var/www/ivm/package-lock.json 2>/dev/null | cut -d' ' -f1 || echo 'changed')
  if [ \"\$OLD_LOCK_HASH\" != \"\$NEW_LOCK_HASH\" ] || [ ! -d /var/www/ivm/node_modules ]; then
    echo 'Dependencies changed, running npm ci...'
    npm ci --omit=dev 2>&1 | tail -1
  else
    echo 'Dependencies unchanged, skipping npm ci.'
  fi
  npx prisma generate 2>&1 | tail -1
  npx prisma migrate deploy 2>&1 | tail -3

  # Stop workers before build so they don't compete for CPU on the 2-core VM
  pm2 stop ivm-worker ivm-detail-worker 2>/dev/null || true

  # Build on VPS using correct env (webpack cache persists for faster incremental builds)
  npm run build 2>&1 | tail -5

  # Standalone mode requires static + public symlinked into .next/standalone/
  mkdir -p .next/standalone/.next
  ln -sfn /var/www/ivm/.next/static .next/standalone/.next/static
  ln -sfn /var/www/ivm/public .next/standalone/public

  rm -f /tmp/ivm-deploy.tar.gz

  pm2 restart ivm ivm-worker ivm-detail-worker
  sleep 3
  curl -s http://localhost:3001/api/health
"

rm -f /tmp/ivm-deploy.tar.gz
echo "Done."
