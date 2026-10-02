#!/usr/bin/env bash
# Production deployment always runs in GitHub Actions, from committed main.
set -euo pipefail

if [ "$#" -ne 0 ]; then
  echo "Usage: bash scripts/deploy.sh (dispatches main through GitHub Actions)" >&2
  echo "Active scrape jobs cannot be bypassed." >&2
  exit 2
fi

gh workflow run deploy.yml --repo BenefitsCare25/ivm --ref main
echo "GitHub deployment requested for main."
echo "Monitor: gh run list --repo BenefitsCare25/ivm --workflow deploy.yml --limit 1"
