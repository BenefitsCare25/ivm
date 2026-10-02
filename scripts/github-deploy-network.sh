#!/usr/bin/env bash
# Run only inside the serialized GitHub deployment workflow after Azure OIDC login.
set -euo pipefail

RESOURCE_GROUP="RG-IVM"
NSG_NAME="ivm-vm-nsg"
RULE_NAME="GitHubActionsDeploy"

case "${1:-}" in
  allow)
    RUNNER_IP=$(cat /tmp/ivm-deployment-runner-ip.txt)
    python3 -c 'import ipaddress,sys; ipaddress.IPv4Address(sys.argv[1])' "$RUNNER_IP"
    # A fixed rule name also replaces stale access from a forcibly terminated run.
    az network nsg rule create \
      --resource-group "$RESOURCE_GROUP" --nsg-name "$NSG_NAME" \
      --name "$RULE_NAME" --priority 301 --direction Inbound \
      --access Allow --protocol Tcp \
      --source-address-prefixes "$RUNNER_IP/32" --source-port-ranges '*' \
      --destination-address-prefixes '*' --destination-port-ranges 22 \
      --description "GitHub IVM deployment ${GITHUB_RUN_ID:?}-${GITHUB_RUN_ATTEMPT:?}" \
      --only-show-errors --output none
    echo "Temporary SSH access granted to this deployment runner only."
    ;;
  revoke)
    az network nsg rule delete \
      --resource-group "$RESOURCE_GROUP" --nsg-name "$NSG_NAME" \
      --name "$RULE_NAME" --only-show-errors --output none
    echo "Temporary deployment SSH access removed."
    ;;
  *)
    echo "Usage: $0 allow|revoke" >&2
    exit 2
    ;;
esac
