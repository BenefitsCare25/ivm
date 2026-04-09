#!/usr/bin/env bash
# Deploy IVM to VPS
# Env source of truth: /etc/ivm/.env (never overwritten by deploys)
set -e

VPS="root@72.62.75.247"
KEY="$HOME/.ssh/id_ed25519"

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
ssh -i "$KEY" "$VPS" "
  set -e
  cd /var/www/ivm
  tar xzf /tmp/ivm-deploy.tar.gz

  # Always symlink .env to persistent config — survives every deploy
  ln -sf /etc/ivm/.env /var/www/ivm/.env

  # Verify correct DB config before continuing
  DB_URL=\$(grep '^DATABASE_URL' /etc/ivm/.env | cut -d= -f2- | tr -d '\"')
  if echo \"\$DB_URL\" | grep -qE ':5432[^3]|/ivm_dev'; then
    echo 'ERROR: /etc/ivm/.env has wrong DATABASE_URL (port 5432 or db ivm_dev)'
    echo \"Current: \$DB_URL\"
    exit 1
  fi
  echo \"DB: \$DB_URL\"

  npm ci --omit=dev 2>&1 | tail -1
  npx prisma generate 2>&1 | tail -1
  npx prisma migrate deploy 2>&1 | tail -3

  # Build on VPS using correct env
  npm run build 2>&1 | tail -5

  pm2 restart ivm ivm-worker ivm-detail-worker
  sleep 3
  curl -s http://localhost:3001/api/health
"

rm /tmp/ivm-deploy.tar.gz
echo "Done."
