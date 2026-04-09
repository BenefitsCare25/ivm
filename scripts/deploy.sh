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

  # Verify DATABASE_URL points to correct port/db
  DB_URL=\$(grep DATABASE_URL .env | cut -d= -f2- | tr -d '\"')
  if echo \"\$DB_URL\" | grep -qE '5432[^3]|ivm_dev'; then
    echo 'ERROR: DATABASE_URL appears wrong (port 5432 or db ivm_dev detected)'
    echo \"Current: \$DB_URL\"
    echo 'Fix .env on VPS before deploying'
    exit 1
  fi

  npm ci --omit=dev 2>&1 | tail -1
  npx prisma generate 2>&1 | tail -1
  npx prisma migrate deploy 2>&1 | tail -3
  pm2 restart ivm ivm-worker ivm-detail-worker --update-env
  sleep 3
  curl -sk https://72.62.75.247/api/health
"

rm /tmp/ivm-deploy.tar.gz
echo "Done."
