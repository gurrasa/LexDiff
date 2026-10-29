#!/usr/bin/env bash
# Deploys LexDiff to Sepolia with gas estimated by the Sepolia node itself.
#
#   ./script/deploy-sepolia.sh            (reads contracts/.env)
#
# Why not `forge script`: Foundry's local EVM prices code deposits far below Sepolia's current
# rules, so its gas estimates fail on-chain. `cast send` asks the node for the real estimate.
# Set SKIP_VERIFY=1 to skip Etherscan verification (e.g. on a local anvil).
#
# Resumable: pass addresses that already deployed and they are reused, e.g.
#   LOGIC=0x… REGISTRY=0x… USDC=0x… V1=0x… V2=0x… ./script/deploy-sepolia.sh
set -euo pipefail
cd "$(dirname "$0")/.."
source .env

RPC="${RPC_URL:-$SEPOLIA_RPC_URL}"
ME=$(cast wallet address "$PRIVATE_KEY")
CLIENT="${CLIENT_ADDRESS:-$ME}"
FREELANCER="${FREELANCER_ADDRESS:-$ME}"
AMOUNT=1000000000 # 1,000 USDC (6 decimals)
CHAIN_ID=$(cast chain-id --rpc-url "$RPC")

forge build --skip test --skip script >/dev/null
bytecode() { node -pe "require('./out/$1.sol/$1.json').bytecode.object"; }

deploy() { # <label> <initcode>
  for attempt in 1 2 3; do
    echo "Deploying $1… (attempt $attempt)" >&2
    local out
    out=$(cast send --private-key "$PRIVATE_KEY" --rpc-url "$RPC" --json --create "$2" 2>&1) || true
    if addr=$(echo "$out" | node -e 'const r=JSON.parse(require("fs").readFileSync(0));if(r.status!=="0x1")process.exit(1);console.log(r.contractAddress)' 2>/dev/null); then
      echo "  $addr" >&2
      echo "$addr"
      return 0
    fi
    echo "  failed: $(echo "$out" | tail -c 400)" >&2
    sleep 5
  done
  echo "Giving up on $1. Re-run with the addresses printed above to resume." >&2
  exit 1
}

verify() { # <address> <path:Name> [extra forge args…]
  [ "${SKIP_VERIFY:-0}" = "1" ] && return 0
  echo "Verifying $2 on Etherscan…" >&2
  for attempt in 1 2 3 4 5; do
    if forge verify-contract "$1" "$2" --chain "$CHAIN_ID" --etherscan-api-key "$ETHERSCAN_API_KEY" --watch "${@:3}" >/dev/null 2>&1; then
      echo "  verified" >&2; return 0
    fi
    sleep 10
  done
  echo "  could not verify $2 yet; retry later with: forge verify-contract $1 $2 --chain $CHAIN_ID ${*:3}" >&2
}

# The deploy block is where the registry's event history starts. When resuming with an existing
# REGISTRY, keep the block recorded at its original deployment instead of "now".
if [ -z "${DEPLOY_BLOCK:-}" ] && [ -n "${REGISTRY:-}" ] && [ -f "deployments/$CHAIN_ID.json" ]; then
  DEPLOY_BLOCK=$(node -pe "require('./deployments/$CHAIN_ID.json').deployBlock")
fi
DEPLOY_BLOCK=${DEPLOY_BLOCK:-$(cast block-number --rpc-url "$RPC")}

LOGIC=${LOGIC:-$(deploy LexDiffLogic "$(bytecode LexDiffLogic)")}
REGISTRY_CODE=$(bytecode LexDiffRegistry | sed -E "s/__\\\$[0-9a-f]{34}\\\$__/$(echo "${LOGIC#0x}" | tr 'A-F' 'a-f')/g")
REGISTRY=${REGISTRY:-$(deploy LexDiffRegistry "$REGISTRY_CODE")}
USDC=${USDC:-$(deploy MockUSDC "$(bytecode MockUSDC)")}
ARGS=$(cast abi-encode "constructor(address,address,address,uint256)" "$USDC" "$CLIENT" "$FREELANCER" "$AMOUNT")
V1=${V1:-$(deploy FreelanceEscrowV1 "$(bytecode FreelanceEscrowV1)${ARGS#0x}")}
V2=${V2:-$(deploy FreelanceEscrowV2 "$(bytecode FreelanceEscrowV2)${ARGS#0x}")}
# Second demo agreement (agreements/website-redesign.md): 2,500 USDC
WEBSITE_ARGS=$(cast abi-encode "constructor(address,address,address,uint256)" "$USDC" "$CLIENT" "$FREELANCER" 2500000000)
WEBSITE=${WEBSITE:-$(deploy WebsiteEscrow "$(bytecode WebsiteEscrow)${WEBSITE_ARGS#0x}")}

mkdir -p deployments
cat > "deployments/$CHAIN_ID.json" <<JSON
{
  "chainId": $CHAIN_ID,
  "deployBlock": $DEPLOY_BLOCK,
  "registry": "$REGISTRY",
  "logic": "$LOGIC",
  "usdc": "$USDC",
  "escrowV1": "$V1",
  "escrowV2": "$V2",
  "websiteEscrow": "$WEBSITE",
  "client": "$CLIENT",
  "freelancer": "$FREELANCER"
}
JSON

verify "$LOGIC" src/LexDiffLogic.sol:LexDiffLogic
verify "$REGISTRY" src/LexDiffRegistry.sol:LexDiffRegistry --libraries "src/LexDiffLogic.sol:LexDiffLogic:$LOGIC"
verify "$USDC" src/demo/MockUSDC.sol:MockUSDC
verify "$V1" src/demo/FreelanceEscrowV1.sol:FreelanceEscrowV1 --constructor-args "$ARGS"
verify "$V2" src/demo/FreelanceEscrowV2.sol:FreelanceEscrowV2 --constructor-args "$ARGS"
verify "$WEBSITE" src/demo/WebsiteEscrow.sol:WebsiteEscrow --constructor-args "$WEBSITE_ARGS"

echo
echo "LexDiffRegistry    $REGISTRY"
echo "LexDiffLogic       $LOGIC"
echo "MockUSDC           $USDC"
echo "FreelanceEscrowV1  $V1"
echo "FreelanceEscrowV2  $V2"
echo "WebsiteEscrow      $WEBSITE"
echo
echo "Saved to contracts/deployments/$CHAIN_ID.json"
echo "Next: set NEXT_PUBLIC_REGISTRY_ADDRESS=$REGISTRY in web/.env.local and registryAddress in cre/lexdiff-workflow/config.staging.json"
