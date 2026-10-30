import { BaseError, ContractFunctionRevertedError, createWalletClient, getAddress, http, type Hex } from 'viem'
import { sepolia } from 'viem/chains'
import { type Persona, PERSONAS, personaAccount } from '@/lib/personas'
import { rateLimited } from '@/lib/rate-limit'
import { publicClient, REGISTRY_ADDRESS, RPC_URL, registrationFromJson, registryAbi } from '@/lib/registry'

// Acts as a presentation-mode identity. It can only sign LexDiff's own EIP-712 messages for this registry
// and only call this registry, so the demo keys cannot be used for anything else.

const SIGNABLE = ['Registration', 'Decision']
const WRITABLE = ['registerAgreement', 'submitDecision', 'proposeContract', 'acceptContract', 'requestCheck'] as const
type Writable = (typeof WRITABLE)[number]

function decodeArgs(functionName: Writable, args: unknown[]): readonly unknown[] {
  switch (functionName) {
    case 'registerAgreement':
      return [registrationFromJson(args[0] as Record<string, unknown>), args[1], args[2]]
    case 'submitDecision': {
      const [id, key, decision, evidence, note, deadline, signer, signature] = args
      return [BigInt(id as string), key, Number(decision), evidence, note, BigInt(deadline as string), signer, signature]
    }
    case 'proposeContract':
    case 'acceptContract':
      return [BigInt(args[0] as string), args[1]]
    case 'requestCheck':
      return [BigInt(args[0] as string)]
  }
}

/** JSON carries bigints as strings; restore them inside typed-data messages. */
function restoreMessage(primaryType: string, m: Record<string, unknown>) {
  if (primaryType === 'Registration') return registrationFromJson(m)
  return { ...m, agreementId: BigInt(m.agreementId as string), nonce: BigInt(m.nonce as string), deadline: BigInt(m.deadline as string) }
}

export async function POST(request: Request) {
  if (rateLimited(request, 120, 60 * 60 * 1000)) return Response.json({ error: 'Too many requests, try again later.' }, { status: 429 })
  const body = (await request.json()) as {
    persona?: Persona
    kind?: 'sign' | 'write'
    typedData?: { domain: Record<string, unknown>; types: Record<string, unknown>; primaryType: string; message: Record<string, unknown> }
    functionName?: string
    args?: unknown[]
  }
  if (!body.persona || !PERSONAS.includes(body.persona)) return Response.json({ error: 'unknown persona' }, { status: 400 })
  const account = personaAccount(body.persona)
  if (!account) return Response.json({ error: 'presentation mode is off' }, { status: 404 })

  try {
    if (body.kind === 'sign') {
      const td = body.typedData
      const forThisRegistry =
        td?.domain.name === 'LexDiff' &&
        Number(td.domain.chainId) === sepolia.id &&
        getAddress(String(td.domain.verifyingContract)) === getAddress(REGISTRY_ADDRESS)
      if (!td || !forThisRegistry || !SIGNABLE.includes(td.primaryType)) {
        return Response.json({ error: 'only LexDiff registrations and decisions can be signed' }, { status: 400 })
      }
      const signature = await account.signTypedData({
        domain: { ...td.domain, chainId: sepolia.id },
        types: td.types,
        primaryType: td.primaryType,
        message: restoreMessage(td.primaryType, td.message),
      } as Parameters<typeof account.signTypedData>[0])
      return Response.json({ signature })
    }

    if (body.kind === 'write' && WRITABLE.includes(body.functionName as Writable) && Array.isArray(body.args)) {
      const call = {
        account,
        address: REGISTRY_ADDRESS,
        abi: registryAbi,
        functionName: body.functionName as Writable,
        args: decodeArgs(body.functionName as Writable, body.args),
      } as never
      await publicClient.simulateContract(call)
      const hash = await createWalletClient({ account, chain: sepolia, transport: http(RPC_URL) }).writeContract(call)
      await publicClient.waitForTransactionReceipt({ hash })
      return Response.json({ hash: hash as Hex })
    }
    return Response.json({ error: 'unsupported action' }, { status: 400 })
  } catch (e) {
    const reverted = e instanceof BaseError ? e.walk((x) => x instanceof ContractFunctionRevertedError) : null
    const name = reverted instanceof ContractFunctionRevertedError ? reverted.data?.errorName : undefined
    const err = e as { shortMessage?: string; message?: string }
    return Response.json({ error: name ?? err.shortMessage ?? 'action failed' }, { status: 400 })
  }
}
