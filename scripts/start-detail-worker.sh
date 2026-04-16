#!/bin/bash
cd /var/www/ivm
set -a
source /etc/ivm/.env
set +a
exec npx tsx src/workers/item-detail-worker.ts
