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

export const STATUS = ['—', 'Open', 'Accepted risk', 'Remediation required', 'Resolved'] as const
export const STATUS_TONE = ['muted', 'bad', 'warn', 'info', 'ok'] as const

<<<<<<< HEAD
export const DecisionType = { AcceptRisk: 1, RequireRemediation: 2, Acknowledge: 3, Dispute: 4 } as const
export const DECISION_LABEL = ['—', 'Accepted risk', 'Remediation required', 'Acknowledged', 'Disputed'] as const

export type Verifier = { forwarder: Address; workflowOwner: Address; workflowId: Hex }
=======
export const DecisionType = { Acknowledge: 1, AcceptRisk: 2, RequireRemediation: 3, Dispute: 4 } as const
export const DECISION_LABEL = ['—', 'Acknowledged', 'Accepted risk', 'Remediation required', 'Disputed'] as const
>>>>>>> df31607 (Align LexDiff with evidence-first design)

export type Agreement = {
  client: Address
  reviewer: Address
  developer: Address
  verifier: Address
  target: Address
  pendingTarget: Address
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
  status: number
<<<<<<< HEAD
  detailsHash: Hex
=======
>>>>>>> df31607 (Align LexDiff with evidence-first design)
  evidenceHash: Hex
  assignee: Address
  firstCheck: number
  lastCheck: number
  resolvedInCheck: number
  disputedInCheck: number
  openedAt: bigint
  resolvedAt: bigint
}

export type Check = {
  target: Address
  codeHash: Hex
  termsHash: Hex
  reportHash: Hex
<<<<<<< HEAD
  workflowId: Hex
  workflowOwner: Address
=======
>>>>>>> df31607 (Align LexDiff with evidence-first design)
  timestamp: bigint
  findingCount: number
  nonMatchCount: number
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

<<<<<<< HEAD
export type Registration = {
  client: Address
  reviewer: Address
  developer: Address
  target: Address
  termsHash: Hex
  termsURI: string
  verifier: Verifier
  supersedes: bigint
  deadline: bigint
}

/** Off-chain report written by the CRE workflow; its hash is anchored in Check.reportHash. */
export type ReportDocument = {
  schema: 'lexdiff/report@1'
  contractName: string
  onchain: Record<string, string>
  findings: { key: Hex; kind: number; clause: string; expected: string; actual: string; detailsHash: Hex }[]
=======
export type AgreementEvent = {
  eventName: string
  transactionHash: Hex
  blockNumber: bigint
  args: Record<string, unknown>
>>>>>>> df31607 (Align LexDiff with evidence-first design)
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
  pendingTarget: (id: bigint) => read<Address>('pendingTargets', [id]),
  nonces: (signer: Address) => read<bigint>('nonces', [signer]),
  events: async (id: bigint) => {
    const fromBlock = BigInt(process.env.NEXT_PUBLIC_REGISTRY_DEPLOYMENT_BLOCK || '0')
    const logs = await publicClient.getContractEvents({
      address: REGISTRY_ADDRESS,
      abi: registryAbi,
      fromBlock,
      toBlock: 'latest',
    })
    return logs
      .filter((log) => 'args' in log && (log.args as { agreementId?: bigint }).agreementId === id)
      .map((log) => ({
        eventName: log.eventName,
        transactionHash: log.transactionHash,
        blockNumber: log.blockNumber,
        args: log.args as Record<string, unknown>,
      })) as AgreementEvent[]
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

/** Fetches evidence and checks it against the hash. Returns null when unavailable or tampered. */
export async function getEvidence<T>(hash: Hex, uri = `/api/evidence/${hash}`): Promise<T | null> {
  try {
    const res = await fetch(uri)
    if (!res.ok) return null
    const value = await res.json()
    return hashEvidence(value) === hash ? (value as T) : null
  } catch {
    return null
  }
}

// --- Wallet ----------------------------------------------------------------

type Eip1193 = { request: (args: { method: string; params?: unknown[] }) => Promise<unknown> }

export async function connectWallet() {
  const ethereum = (globalThis as { ethereum?: Eip1193 }).ethereum
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

<<<<<<< HEAD
export const REGISTRATION_TYPES = {
  Registration: [
=======
export const AGREEMENT_APPROVAL_TYPES = {
  AgreementApproval: [
>>>>>>> df31607 (Align LexDiff with evidence-first design)
    { name: 'client', type: 'address' },
    { name: 'reviewer', type: 'address' },
    { name: 'developer', type: 'address' },
    { name: 'target', type: 'address' },
<<<<<<< HEAD
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
=======
    { name: 'verifier', type: 'address' },
    { name: 'termsHash', type: 'bytes32' },
    { name: 'termsURIHash', type: 'bytes32' },
    { name: 'titleHash', type: 'bytes32' },
    { name: 'nonce', type: 'uint256' },
    { name: 'deadline', type: 'uint256' },
  ],
} as const

>>>>>>> df31607 (Align LexDiff with evidence-first design)
export const shortAddr = (a: string) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : '')
export const fmtTime = (ts: bigint) => (ts ? new Date(Number(ts) * 1000).toLocaleString() : '—')
