import { createPublicClient, createWalletClient, custom, http, type Address, type Hex } from 'viem'
import { sepolia } from 'viem/chains'
import { registryAbi } from './registry-abi'

export { registryAbi }

export const REGISTRY_ADDRESS = (process.env.NEXT_PUBLIC_REGISTRY_ADDRESS ?? '') as Address
export const RPC_URL = process.env.NEXT_PUBLIC_SEPOLIA_RPC_URL || 'https://ethereum-sepolia-rpc.publicnode.com'
export const EXPLORER = 'https://sepolia.etherscan.io'

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

export const DecisionType = { AcceptRisk: 1, RequireRemediation: 2 } as const
export const DECISION_LABEL = ['—', 'Accepted risk', 'Remediation required'] as const

export type Agreement = {
  client: Address
  reviewer: Address
  developer: Address
  target: Address
  termsHash: Hex
  termsURI: string
  title: string
  createdAt: bigint
}

export type Finding = {
  key: Hex
  kind: number
  status: number
  clause: string
  expected: string
  actual: string
  evidenceHash: Hex
  assignee: Address
  firstCheck: number
  lastCheck: number
  resolvedInCheck: number
  openedAt: bigint
  resolvedAt: bigint
}

export type Check = {
  target: Address
  codeHash: Hex
  termsHash: Hex
  timestamp: bigint
  findingCount: number
  nonMatchCount: number
}

export type Decision = {
  decision: number
  signer: Address
  evidenceHash: Hex
  note: string
  signature: Hex
  timestamp: bigint
  atCheck: number
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

export const shortAddr = (a: string) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : '')
export const fmtTime = (ts: bigint) => (ts ? new Date(Number(ts) * 1000).toLocaleString() : '—')
