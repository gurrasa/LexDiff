import { BaseError, ContractFunctionRevertedError, createWalletClient, decodeEventLog, http, type Hex } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { sepolia } from 'viem/chains'
import { rateLimited } from '@/lib/rate-limit'
import { authorizedMutation, boundedJson, payloadResponse } from '@/lib/server/request-guard'
import { same, registry } from '@/lib/registry'
import { publicClient, REGISTRY_ADDRESS, RPC_URL, registrationFromJson, registryAbi } from '@/lib/registry'

// Gasless submission of already-signed actions. The registry decides who acted from the EIP-712 signature,
// not from the transaction sender, so relaying cannot change what anyone decided. Only the two
// signature-based functions are relayed; actions that need msg.sender (propose/approve a contract,
// request a check) are still sent from the party's own wallet.

const RELAYABLE = ['registerAgreement', 'submitDecision'] as const

// Registry errors in words the signer understands.
const REASONS: Record<string, string> = {
  InvalidSignature: 'The signature does not belong to the expected party.',
  WrongRole: 'Your role in this agreement cannot make this decision.',
  StaleEvidence: 'The finding changed after you signed (a new check ran). Reload the page and sign again.',
  SignatureExpired: 'The signature expired. Sign again.',
  NotApplicable: 'This decision does not apply to the finding in its current state.',
  ReasonRequired: 'A dispute needs a written reason.',
  RegistrationReplayed: 'This agreement is already registered.',
  CannotSupersede: 'This agreement cannot be amended by these parties.',
  UnknownAgreement: 'Unknown agreement.',
  UnknownFinding: 'Unknown finding.',
  ZeroAddress: 'Every party and the contract need an address.',
}
type Relayable = (typeof RELAYABLE)[number]

const relayer = () => {
  const key = process.env.RELAYER_PRIVATE_KEY?.trim()
  if (!key) return null
  return privateKeyToAccount((key.startsWith('0x') ? key : `0x${key}`) as Hex)
}

/** JSON carries bigints as decimal strings; restore the exact argument types the ABI expects. */
function decodeArgs(functionName: Relayable, args: unknown[]): readonly unknown[] {
  if (functionName === 'registerAgreement') {
    return [registrationFromJson(args[0] as Record<string, unknown>), args[1], args[2]]
  }
  const [id, key, decision, evidence, note, deadline, signer, signature] = args
  return [BigInt(id as string), key, Number(decision), evidence, note, BigInt(deadline as string), signer, signature]
}

export async function POST(request: Request) {
  const caller = authorizedMutation(request)
  if (!caller) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  const account = relayer()
  if (!account) return Response.json({ error: 'relayer not configured' }, { status: 501 })
  if (rateLimited(request, 10, 60 * 60 * 1000)) return Response.json({ error: 'Too many requests, try again later.' }, { status: 429 })

  let input: { functionName?: string; args?: unknown[] }
  try { input = await boundedJson(request, 16_000) as typeof input }
  catch (error) { return payloadResponse(error) }
  const { functionName, args } = input ?? {}
  if (!RELAYABLE.includes(functionName as Relayable) || !Array.isArray(args)) {
    return Response.json({ error: 'only signed actions can be relayed' }, { status: 400 })
  }

  try {
    if (functionName === 'registerAgreement') {
      const reg = registrationFromJson(args[0] as Record<string, unknown>)
      if (![reg.client, reg.reviewer].some(a => same(a, caller))) return Response.json({ error: 'Forbidden' }, { status: 403 })
    } else {
      if (!same(String(args[6]), caller)) return Response.json({ error: 'Forbidden' }, { status: 403 })
      const agreementId = BigInt(args[0] as string)
      const agreement = await registry.getAgreement(agreementId)
      if (![agreement.client, agreement.reviewer, agreement.developer, agreement.freelancer].some(a => same(a, caller))) {
        return Response.json({ error: 'Forbidden' }, { status: 403 })
      }
    }
    const call = {
      account,
      address: REGISTRY_ADDRESS,
      abi: registryAbi,
      functionName: functionName as Relayable,
      args: decodeArgs(functionName as Relayable, args),
    } as never
    // Simulate first so a bad signature or wrong role returns a readable error instead of a failed tx.
    await publicClient.simulateContract(call)
    const wallet = createWalletClient({ account, chain: sepolia, transport: http(RPC_URL) })
    const hash = await wallet.writeContract(call)
    const receipt = await publicClient.waitForTransactionReceipt({ hash })
    if (receipt.status !== 'success') return Response.json({ error: 'transaction reverted', hash }, { status: 502 })

    let agreementId: string | undefined
    for (const log of receipt.logs) {
      try {
        const ev = decodeEventLog({ abi: registryAbi, data: log.data, topics: log.topics })
        if (ev.eventName === 'AgreementRegistered') agreementId = (ev.args as { agreementId: bigint }).agreementId.toString()
      } catch {}
    }
    return Response.json({ hash, agreementId })
  } catch (e) {
    const reverted = e instanceof BaseError ? e.walk((x) => x instanceof ContractFunctionRevertedError) : null
    const name = reverted instanceof ContractFunctionRevertedError ? reverted.data?.errorName : undefined
    const err = e as { shortMessage?: string; message?: string }
    return Response.json({ error: (name && REASONS[name]) ?? name ?? err.shortMessage ?? 'relay failed' }, { status: 400 })
  }
}
