#!/usr/bin/env bash
# Deploy IVM to VPS — excludes .env so VPS config is preserved
set -e

VPS="root@72.62.75.247"
KEY="$HOME/.ssh/id_ed25519"

echo "Building..."
npm run build

echo "Creating tarball (excluding .env and uploads)..."
tar czf /tmp/ivm-deploy.tar.gz \
  --exclude=node_modules \
  --exclude=.git \
  --exclude="*.tar.gz" \
  --exclude=.env \
  --exclude=uploads \
  .

echo "Uploading..."
scp -i "$KEY" /tmp/ivm-deploy.tar.gz "$VPS":/tmp/ivm-deploy.tar.gz

echo "Deploying on VPS..."
ssh -i "$KEY" "$VPS" "
  cd /var/www/ivm
  tar xzf /tmp/ivm-deploy.tar.gz
  npm ci --omit=dev 2>&1 | tail -1
  npx prisma generate 2>&1 | tail -1
  pm2 restart ivm
  sleep 3
  curl -sk https://72.62.75.247/api/health
"

rm /tmp/ivm-deploy.tar.gz
echo "Done."
