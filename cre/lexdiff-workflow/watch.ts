// Local Chainlink CRE "node" for the demo.
//
// Watches LexDiffRegistry on Sepolia for CheckRequested events (emitted on registration, on an accepted
// contract replacement, and by "Request a Chainlink check") and runs the workflow through the CRE CLI
// simulator for each one. In production this script is unnecessary: the deployed workflow's EVM log
// trigger listens to the same event.
//
//   cd cre/lexdiff-workflow && node watch.ts            (watch from now on)
//   node watch.ts --from 12015602                         (also process older requests)
//   node watch.ts --dry-run                               (log what would run, send nothing)

import { spawn } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'
import { createPublicClient, http, parseAbi } from 'viem'
import { sepolia } from 'viem/chains'

const here = path.dirname(new URL(import.meta.url).pathname)
const creDir = path.join(here, '..')
const config = JSON.parse(readFileSync(path.join(here, 'config.staging.json'), 'utf8'))
// cre/.env locally; plain environment variables in the cloud worker (which also writes cre/.env for the CLI).
const envFile = path.join(creDir, '.env')
const env: Record<string, string | undefined> = existsSync(envFile)
  ? Object.fromEntries(
      readFileSync(envFile, 'utf8')
        .split('\n')
        .filter((l) => /^\w+=/.test(l))
        .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]),
    )
  : process.env
const rpc = env.SEPOLIA_RPC_URL || 'https://ethereum-sepolia-rpc.publicnode.com'
const registry = config.registryAddress as `0x${string}`
const abi = parseAbi([
  'event CheckRequested(uint256 indexed agreementId, address indexed target, bytes32 termsHash)',
  'struct Verifier { address forwarder; address workflowOwner; bytes32 workflowId; }',
  'struct Agreement { address client; address reviewer; address developer; address target; address pendingTarget; bytes32 termsHash; string termsURI; Verifier verifier; uint256 supersedes; uint256 supersededBy; uint64 createdAt; }',
  'function getAgreement(uint256 agreementId) view returns (Agreement)',
])
const MOCK_FORWARDER = '0x15fc6ae953e024d975e77382eeec56a9101f9f88'
const client = createPublicClient({ chain: sepolia, transport: http(rpc) })

const dryRun = process.argv.includes('--dry-run')
// Where to start: --from / WATCH_FROM, else the block saved in STATE_FILE (so a restarted worker misses
// nothing), else now.
const stateFile = process.env.STATE_FILE
const fromArg = process.argv.indexOf('--from')
const saved = stateFile && existsSync(stateFile) ? BigInt(JSON.parse(readFileSync(stateFile, 'utf8')).next) : null
let next =
  fromArg > 0 ? BigInt(process.argv[fromArg + 1])
  : process.env.WATCH_FROM ? BigInt(process.env.WATCH_FROM)
  : saved ?? (await client.getBlockNumber()) + 1n
const saveState = () => stateFile && writeFileSync(stateFile, JSON.stringify({ next: next.toString() }))
const seen = new Set<string>()
const queue: { agreementId: bigint; tx: string }[] = []
let running = false

const log = (msg: string) => console.log(`[${new Date().toLocaleTimeString()}] ${msg}`)

// The CLI shells out to bun; make both findable even if this terminal's PATH lacks them.
const PATH = [path.join(homedir(), '.bun', 'bin'), path.join(homedir(), '.cre', 'bin'), process.env.PATH].join(path.delimiter)

function simulate(agreementId: bigint): Promise<number> {
  const args = [
    'workflow', 'simulate', 'lexdiff-workflow', '--target', 'staging-settings', '--broadcast',
    '--non-interactive', '--trigger-index', '0', '--http-payload', JSON.stringify({ agreementId: Number(agreementId) }),
  ]
  return new Promise((resolve) => {
    const child = spawn('cre', args, { cwd: creDir, env: { ...process.env, PATH }, stdio: 'inherit' })
    child.on('error', (e) => {
      log(`could not start the CRE CLI: ${e.message}`)
      resolve(1)
    })
    child.on('close', (code) => resolve(code ?? 1))
  })
}

async function drain() {
  if (running) return
  running = true
  while (queue.length) {
    const { agreementId, tx } = queue.shift()!
    const a = await client.readContract({ address: registry, abi, functionName: 'getAgreement', args: [agreementId] })
    if (a.verifier.forwarder.toLowerCase() !== MOCK_FORWARDER) {
      log(`#${agreementId}: verifier is not the simulation forwarder; leaving it to the deployed workflow`)
      continue
    }
    const termsHost = new URL(a.termsURI).host
    const storeHost = new URL(config.evidenceStoreUrl).host
    if (termsHost !== storeHost) {
      log(`#${agreementId}: warning — terms live on ${termsHost} but evidenceStoreUrl points to ${storeHost}; the report will not show up on ${termsHost}`)
    }
    log(`#${agreementId}: running Chainlink check (requested in ${tx})`)
    const code = dryRun ? 0 : await simulate(agreementId)
    log(`#${agreementId}: ${code === 0 ? 'report written ✓' : `failed (exit ${code})`}`)
  }
  running = false
}

async function poll() {
  try {
    const latest = await client.getBlockNumber()
    if (latest >= next) {
      const events = await client.getContractEvents({ address: registry, abi, eventName: 'CheckRequested', fromBlock: next, toBlock: latest })
      for (const ev of events) {
        const id = `${ev.transactionHash}:${ev.logIndex}`
        if (seen.has(id)) continue
        seen.add(id)
        // One pending check per agreement is enough: it always checks the current contract.
        if (!queue.some((q) => q.agreementId === ev.args.agreementId)) queue.push({ agreementId: ev.args.agreementId!, tx: ev.transactionHash })
        log(`CheckRequested for agreement #${ev.args.agreementId}`)
      }
      next = latest + 1n
      saveState()
      void drain()
    }
  } catch (e) {
    log(`poll failed: ${(e as Error).message.split('\n')[0]}`)
  }
}

log(`Watching ${registry} on Sepolia for CheckRequested from block ${next} (evidence store: ${config.evidenceStoreUrl})`)
await poll()
setInterval(poll, 12_000)
