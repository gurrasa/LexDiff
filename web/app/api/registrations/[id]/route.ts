import type { Hex } from 'viem'
import { loadPending, registrationId, savePending } from '@/lib/pending'
import { DOMAIN, publicClient, REGISTRATION_TYPES, registrationFromJson, registry, same } from '@/lib/registry'
import { authorizedMutation, boundedJson, payloadResponse } from '@/lib/server/request-guard'
import { sessionAddress } from '@/lib/server/wallet-session'

export async function GET(request: Request, ctx: RouteContext<'/api/registrations/[id]'>) {
  const caller = sessionAddress(request)
  if (!caller) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await ctx.params
  const pending = await loadPending(id)
  if (!pending || ![pending.registration.client, pending.registration.reviewer, pending.registration.freelancer, pending.registration.developer].some(a => same(a, caller))) {
    return Response.json({ error: 'Not found' }, { status: 404 })
  }
  return Response.json(pending)
}

export async function POST(request: Request, ctx: RouteContext<'/api/registrations/[id]'>) {
  const caller = authorizedMutation(request)
  if (!caller) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await ctx.params
  const pending = await loadPending(id)
  if (!pending) return Response.json({ error: 'Not found' }, { status: 404 })
  const registration = registrationFromJson(pending.registration)
  if (registrationId(registration) !== id) return Response.json({ error: 'Corrupt registration' }, { status: 500 })
  if (![registration.client, registration.reviewer, registration.freelancer, registration.developer].some(a => same(a, caller))) {
    return Response.json({ error: 'Not found' }, { status: 404 })
  }
  let body: { role?: 'client' | 'reviewer'; signature?: Hex; agreementId?: string }
  try { body = await boundedJson(request, 16_000) as typeof body }
  catch (error) { return payloadResponse(error) }

  if (body?.agreementId !== undefined) {
    if (!/^\d{1,20}$/.test(body.agreementId) || !same(caller, registration.client)) {
      return Response.json({ error: 'Forbidden or invalid agreement ID' }, { status: 403 })
    }
    const a = await registry.getAgreement(BigInt(body.agreementId)).catch(() => null)
    if (!a || !same(a.client, registration.client) || !same(a.reviewer, registration.reviewer) ||
        !same(a.freelancer, registration.freelancer) || !same(a.developer, registration.developer) ||
        !same(a.target, registration.target) || a.termsHash.toLowerCase() !== registration.termsHash.toLowerCase() ||
        a.agreementHash.toLowerCase() !== registration.agreementHash.toLowerCase()) {
      return Response.json({ error: 'Agreement does not match registration' }, { status: 400 })
    }
    pending.agreementId = body.agreementId
    await savePending(pending)
    return Response.json(pending)
  }

  const { role, signature } = body ?? {}
  if ((role !== 'client' && role !== 'reviewer') || !signature || !/^0x[0-9a-f]+$/i.test(signature)) {
    return Response.json({ error: 'Role and signature are required' }, { status: 400 })
  }
  if (!same(caller, registration[role])) return Response.json({ error: 'Forbidden' }, { status: 403 })
  const valid = await publicClient.verifyTypedData({
    address: registration[role], domain: DOMAIN(), types: REGISTRATION_TYPES,
    primaryType: 'Registration', message: registration, signature,
  }).catch(() => false)
  if (!valid) return Response.json({ error: 'Invalid signature' }, { status: 400 })
  pending.signatures[role] = signature
  if (same(registration.client, registration.reviewer)) pending.signatures = { client: signature, reviewer: signature }
  await savePending(pending)
  return Response.json(pending)
}
