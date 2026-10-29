import { createPublicClient, createWalletClient, custom, http, keccak256, toBytes, type Address, type Hex } from 'viem'
import { sepolia } from 'viem/chains'
import { registryAbi } from './registry-abi'
import { canonicalize } from './terms'

export { registryAbi }

export const REGISTRY_ADDRESS = (process.env.NEXT_PUBLIC_REGISTRY_ADDRESS ?? '') as Address
export const RPC_URL = process.env.NEXT_PUBLIC_SEPOLIA_RPC_URL || 'https://ethereum-sepolia-rpc.publicnode.com'
export const EXPLORER = 'https://sepolia.etherscan.io'
/** Forwarder used by `cre workflow simulate --broadcast` on Sepolia. Production uses the KeystoneForwarder. */
export const SEPOLIA_MOCK_FORWARDER = '0x15fC6ae953E024d975e77382eEeC56A9101f9F88' as Address
export const ZERO_BYTES32 = `0x${'0'.repeat(64)}` as Hex

export const publicClient = createPublicClient({ chain: sepolia, transport: http(RPC_URL) })

// Mirrors the enums in LexDiffRegistry.sol
export const KIND = [
  { label: 'Match', icon: '✅', tone: 'ok' },
  { label: 'Mismatch', icon: '⚠️', tone: 'warn' },
  { label: 'Missing', icon: '❌', tone: 'bad' },
  { label: 'Hidden power', icon: '🚩', tone: 'bad' },
] as const

// The three independent dimensions of a finding (ILexDiff.Verification / Remediation / Disposition).
export const Verification = { NotChecked: 0, Pass: 1, Fail: 2, Inconclusive: 3 } as const
export const Remediation = { None: 0, Required: 1, FixProposed: 2, FixVerified: 3, Reopened: 4 } as const
export const Disposition = { Undecided: 0, Accepted: 1, Rejected: 2, Disputed: 3 } as const

export const VERIFICATION = [
  { label: 'Not checked', tone: 'muted' },
  { label: 'Pass', tone: 'ok' },
  { label: 'Fail', tone: 'bad' },
  { label: 'Inconclusive', tone: 'warn' },
] as const
export const REMEDIATION = [
  { label: 'No fix requested', tone: 'muted' },
  { label: 'Fix required', tone: 'info' },
  { label: 'Fix proposed', tone: 'info' },
  { label: 'Fix verified', tone: 'ok' },
  { label: 'Fix reopened', tone: 'bad' },
] as const
export const DISPOSITION = [
  { label: 'Undecided', tone: 'muted' },
  { label: 'Risk accepted by client', tone: 'warn' },
  { label: 'Risk not accepted', tone: 'info' },
  { label: 'Disputed', tone: 'warn' },
] as const

export const DecisionType = { AcceptRisk: 1, RequireRemediation: 2, Acknowledge: 3, Dispute: 4 } as const
export const DECISION_LABEL = ['—', 'Accepted risk', 'Remediation required', 'Acknowledged', 'Disputed'] as const

export type Verifier = { forwarder: Address; workflowOwner: Address; workflowId: Hex }

export type Agreement = {
  client: Address
  reviewer: Address
  developer: Address
  freelancer: Address
  target: Address
  pendingTarget: Address
  agreementHash: Hex
  termsHash: Hex
  termsURI: string
  verifier: Verifier
  supersedes: bigint
  supersededBy: bigint
  createdAt: bigint
}

export type Finding = {
  key: Hex
  kind: number
  verification: number
  remediation: number
  disposition: number
  detailsHash: Hex
  evidenceHash: Hex
  assignee: Address
  firstCheck: number
  lastCheck: number
  lastFailedCheck: number
  fixVerifiedInCheck: number
  disputedInCheck: number
  openedAt: bigint
  fixVerifiedAt: bigint
}

export type Check = {
  target: Address
  codeHash: Hex
  termsHash: Hex
  reportHash: Hex
  workflowId: Hex
  workflowOwner: Address
  timestamp: bigint
  passed: number
  failed: number
  inconclusive: number
}

export type Decision = {
  decision: number
  signer: Address
  evidenceHash: Hex
  noteHash: Hex
  signature: Hex
  timestamp: bigint
  atCheck: number
}

export type AgreementEvent = {
  eventName: string
  transactionHash: Hex
  blockNumber: bigint
  args: Record<string, unknown>
}

/** A registration waiting for the client's and reviewer's signatures, shared via /sign/[id]. */
export type PendingRegistration = {
  id: Hex
  registration: Registration
  signatures: { client?: Hex; reviewer?: Hex }
  agreementId?: string
}

/** JSON can't carry bigint: Registration travels with supersedes/deadline as decimal strings. */
export const registrationToJson = (r: Registration) => ({ ...r, supersedes: r.supersedes.toString(), deadline: r.deadline.toString() })
export const registrationFromJson = (r: Record<string, unknown>): Registration =>
  ({ ...(r as Registration), supersedes: BigInt(r.supersedes as string), deadline: BigInt(r.deadline as string) })

export type Registration = {
  client: Address
  reviewer: Address
  developer: Address
  freelancer: Address
  target: Address
  agreementHash: Hex
  termsHash: Hex
  termsURI: string
  verifier: Verifier
  supersedes: bigint
  deadline: bigint
}

/** Off-chain report written by the CRE workflow; its hash is anchored in Check.reportHash. */
export type Level = 'value' | 'structural'

export type ReportDocument = {
  schema: 'lexdiff/report@1' | 'lexdiff/report@2' | 'lexdiff/report@3'
  contractName: string
  onchain: Record<string, string>
  findings: {
    key: Hex
    kind: number
    clause: string
    expected: string
    actual: string
    detailsHash: Hex
    result?: number // @3: 1 Pass, 2 Fail, 3 Inconclusive
    level?: Level // @2
    method?: string // @2
  }[]
  /** @2: what was and was not checked, so nothing unchecked looks like a Match */
  coverage?: {
    checked: number
    byLevel: Record<Level, number>
    unchecked: { term: string; text: string; reason: string }[]
  }
  /** @3: where the money is; approving a contract does not move funds */
  operational?: {
    target: Address
    targetBalance: string
    expectedAmount: string
    previousTarget: Address | null
    previousBalance: string | null
  }
}

/** The full signed agreement, stored off-chain; its hash is bound at registration. */
export type AgreementDocument = { schema: 'lexdiff/agreement-document@1'; text: string }

/** How a finding was established (F06). */
export const LEVEL_PLAIN: Record<Level, { icon: string; label: string }> = {
  value: { icon: '🔢', label: 'Read from the contract on Sepolia' },
  structural: { icon: '📄', label: 'From the verified source code (not executed)' },
}

const read = <T>(functionName: string, args: readonly unknown[] = []) =>
  publicClient.readContract({ address: REGISTRY_ADDRESS, abi: registryAbi, functionName, args } as never) as Promise<T>

export const registry = {
  agreementCount: () => read<bigint>('agreementCount'),
  getAgreement: (id: bigint) => read<Agreement>('getAgreement', [id]),
  getFindings: (id: bigint) => read<Finding[]>('getFindings', [id]),
  getChecks: (id: bigint) => read<Check[]>('getChecks', [id]),
  getContractHistory: (id: bigint) => read<Address[]>('getContractHistory', [id]),
  getDecisions: (id: bigint, key: Hex) => read<Decision[]>('getDecisions', [id, key]),
  nonces: (signer: Address) => read<bigint>('nonces', [signer]),
  getEvents: async (id: bigint): Promise<AgreementEvent[]> => {
    const fromBlock = BigInt(process.env.NEXT_PUBLIC_REGISTRY_DEPLOYMENT_BLOCK || '12019746')
    const logs = await publicClient.getContractEvents({
      address: REGISTRY_ADDRESS,
      abi: registryAbi,
      fromBlock,
      toBlock: 'latest',
    })
    return logs
      .filter((log) => {
        if (!('args' in log) || !log.args) return false
        return (log.args as { agreementId?: bigint }).agreementId === id
      })
      .map((log) => ({
        eventName: log.eventName,
        transactionHash: log.transactionHash,
        blockNumber: log.blockNumber,
        args: log.args as Record<string, unknown>,
      }))
  },
}

// --- Off-chain evidence (content-addressed, verified against on-chain hashes) ----------------

export const hashEvidence = (value: unknown) => keccak256(toBytes(canonicalize(value)))
export const noteValue = (note: string) => ({ note })

export async function putEvidence(value: unknown): Promise<{ hash: Hex; uri: string }> {
  const res = await fetch('/api/evidence', { method: 'POST', body: JSON.stringify(value) })
  const body = await res.json()
  if (!res.ok) throw new Error(body.error)
  return body
}

/**
 * Fetches evidence and checks it against the hash. Returns null when unavailable or tampered.
 * Tries this app's own store first, then `uri` (e.g. a termsURI recorded as http://localhost:3000/…,
 * which only works on the machine that registered it). The hash check makes the source irrelevant.
 */
export async function getEvidence<T>(hash: Hex, uri?: string): Promise<T | null> {
  for (const source of [`/api/evidence/${hash}`, uri]) {
    if (!source) continue
    try {
      const res = await fetch(source)
      if (!res.ok) continue
      const value = await res.json()
      if (hashEvidence(value) === hash) return value as T
    } catch {}
  }
  return null
}

// --- Wallet ----------------------------------------------------------------

type Eip1193 = {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>
  on?: (event: string, cb: (accounts: string[]) => void) => void
  removeListener?: (event: string, cb: (accounts: string[]) => void) => void
}

const injected = () => (globalThis as { ethereum?: Eip1193 }).ethereum

/** Currently connected account without prompting, plus updates when the user switches account in MetaMask. */
export function watchAccount(onChange: (account: Address | null) => void): () => void {
  const ethereum = injected()
  if (!ethereum) return () => {}
  const handler = (accounts: string[]) => onChange((accounts[0] as Address) ?? null)
  ethereum.request({ method: 'eth_accounts' }).then((a) => handler(a as string[])).catch(() => {})
  ethereum.on?.('accountsChanged', handler)
  return () => ethereum.removeListener?.('accountsChanged', handler)
}

export async function connectWallet() {
  const ethereum = injected()
  if (!ethereum) throw new Error('No injected wallet found. Install MetaMask or a compatible wallet.')
  const wallet = createWalletClient({ chain: sepolia, transport: custom(ethereum) })
  const [account] = await wallet.requestAddresses()
  if ((await wallet.getChainId()) !== sepolia.id) await wallet.switchChain({ id: sepolia.id })
  return { wallet, account }
}

export async function writeRegistry(functionName: string, args: readonly unknown[]) {
  const { wallet, account } = await connectWallet()
  const hash = await wallet.writeContract({
    account,
    chain: sepolia,
    address: REGISTRY_ADDRESS,
    abi: registryAbi,
    functionName,
    args,
  } as never)
  return publicClient.waitForTransactionReceipt({ hash })
}

export const DOMAIN = () =>
  ({ name: 'LexDiff', version: '1', chainId: sepolia.id, verifyingContract: REGISTRY_ADDRESS }) as const

export const DECISION_TYPES = {
  Decision: [
    { name: 'agreementId', type: 'uint256' },
    { name: 'findingKey', type: 'bytes32' },
    { name: 'decision', type: 'uint8' },
    { name: 'evidenceHash', type: 'bytes32' },
    { name: 'noteHash', type: 'bytes32' },
    { name: 'nonce', type: 'uint256' },
    { name: 'deadline', type: 'uint256' },
  ],
} as const

export const REGISTRATION_TYPES = {
  Registration: [
    { name: 'client', type: 'address' },
    { name: 'reviewer', type: 'address' },
    { name: 'developer', type: 'address' },
    { name: 'freelancer', type: 'address' },
    { name: 'target', type: 'address' },
    { name: 'agreementHash', type: 'bytes32' },
    { name: 'termsHash', type: 'bytes32' },
    { name: 'termsURI', type: 'string' },
    { name: 'verifier', type: 'Verifier' },
    { name: 'supersedes', type: 'uint256' },
    { name: 'deadline', type: 'uint256' },
  ],
  Verifier: [
    { name: 'forwarder', type: 'address' },
    { name: 'workflowOwner', type: 'address' },
    { name: 'workflowId', type: 'bytes32' },
  ],
} as const

export const same = (a?: string, b?: string) => !!a && !!b && a.toLowerCase() === b.toLowerCase()
export const shortAddr = (a: string) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : '')
export const fmtTime = (ts: bigint) => (ts ? new Date(Number(ts) * 1000).toLocaleString() : '—')
