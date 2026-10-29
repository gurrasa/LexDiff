#!/usr/bin/env bash
# Starts the cloud worker. Everything sensitive comes from Railway variables:
#   CRE_ETH_PRIVATE_KEY      key that sends the report transaction (no 0x)
#   ETHERSCAN_API_KEY_VALUE  Etherscan V2 API key
#   SEPOLIA_RPC_URL          optional, defaults to publicnode
#   CRE_CREDENTIALS_B64      base64 of ~/.cre/cre.yaml (your `cre login` session)
#   CRE_CONTEXT_B64          base64 of ~/.cre/context.yaml
# A volume at /data keeps the (refreshed) login session and the last processed block across restarts.
set -euo pipefail
cd /app

DATA=${DATA_DIR:-/data}
mkdir -p "$DATA" /root/.cre

# Login session: seed the volume once from the variable, then keep using the volume copy, because the
# CLI refreshes and rewrites it.
if [ ! -s "$DATA/cre.yaml" ]; then
  [ -n "${CRE_CREDENTIALS_B64:-}" ] || { echo "CRE_CREDENTIALS_B64 is not set"; exit 1; }
  echo "$CRE_CREDENTIALS_B64" | base64 -d > "$DATA/cre.yaml"
fi
ln -sf "$DATA/cre.yaml" /root/.cre/cre.yaml
if [ -n "${CRE_CONTEXT_B64:-}" ]; then echo "$CRE_CONTEXT_B64" | base64 -d > /root/.cre/context.yaml; fi
chmod 600 "$DATA/cre.yaml"

# The CLI reads the project's .env.
cat > .env <<ENV
CRE_ETH_PRIVATE_KEY=${CRE_ETH_PRIVATE_KEY:?CRE_ETH_PRIVATE_KEY is not set}
CRE_TARGET=staging-settings
SEPOLIA_RPC_URL=${SEPOLIA_RPC_URL:-https://ethereum-sepolia-rpc.publicnode.com}
ETHERSCAN_API_KEY_VALUE=${ETHERSCAN_API_KEY_VALUE:?ETHERSCAN_API_KEY_VALUE is not set}
ENV

cre whoami || echo "Warning: CRE login could not be validated; checks will fail until the session works."

export STATE_FILE="$DATA/watch-state.json"
cd lexdiff-workflow
exec node watch.ts
