import type { Hex } from 'viem'
import { loadPending, registrationId, savePending } from '@/lib/pending'
import { DOMAIN, publicClient, REGISTRATION_TYPES, registrationFromJson, registry, same } from '@/lib/registry'

export async function GET(_request: Request, ctx: RouteContext<'/api/registrations/[id]'>) {
  const { id } = await ctx.params
  const pending = await loadPending(id)
  return pending ? Response.json(pending) : Response.json({ error: 'not found' }, { status: 404 })
}

/**
 * Adds a signature ({ role, signature }) or records the on-chain agreement id ({ agreementId }).
 * Signatures are verified here so a shared link can never collect a signature the registry would reject.
 */
export async function POST(request: Request, ctx: RouteContext<'/api/registrations/[id]'>) {
  const { id } = await ctx.params
  const pending = await loadPending(id)
  if (!pending) return Response.json({ error: 'not found' }, { status: 404 })
  const registration = registrationFromJson(pending.registration)
  if (registrationId(registration) !== id) return Response.json({ error: 'corrupt registration' }, { status: 500 })
  const body = (await request.json()) as { role?: 'client' | 'reviewer'; signature?: Hex; agreementId?: string }

  if (body.agreementId) {
    // Only accept an id whose on-chain agreement carries these terms.
    const a = await registry.getAgreement(BigInt(body.agreementId)).catch(() => null)
    if (!a || a.termsHash !== registration.termsHash || !same(a.client, registration.client)) {
      return Response.json({ error: 'agreement does not match this registration' }, { status: 400 })
    }
    pending.agreementId = body.agreementId
    await savePending(pending)
    return Response.json(pending)
  }

  const { role, signature } = body
  if ((role !== 'client' && role !== 'reviewer') || !signature) {
    return Response.json({ error: 'role and signature are required' }, { status: 400 })
  }
  const valid = await publicClient.verifyTypedData({
    address: registration[role],
    domain: DOMAIN(),
    types: REGISTRATION_TYPES,
    primaryType: 'Registration',
    message: registration,
    signature,
  })
  if (!valid) return Response.json({ error: `this is not a valid signature by the ${role}` }, { status: 400 })
  pending.signatures[role] = signature
  // One wallet holding both roles signs once.
  if (same(registration.client, registration.reviewer)) pending.signatures = { client: signature, reviewer: signature }
  await savePending(pending)
  return Response.json(pending)
}
