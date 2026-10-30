import { isAddress } from 'viem'
import { loadPending, pendingFor, registrationId, savePending } from '@/lib/pending'
import { registrationFromJson, registrationToJson, same } from '@/lib/registry'
import { authorizedMutation, boundedJson, payloadResponse } from '@/lib/server/request-guard'
import { sessionAddress } from '@/lib/server/wallet-session'

/** Creates a pending registration only for an authenticated participant. */
export async function POST(request: Request) {
  const caller = authorizedMutation(request)
  if (!caller) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  let body: { registration?: Record<string, unknown> }
  try { body = await boundedJson(request, 16_000) as typeof body }
  catch (error) { return payloadResponse(error) }
  let registration
  try { registration = registrationFromJson(body?.registration ?? {}) }
  catch { return Response.json({ error: 'Invalid registration' }, { status: 400 }) }
  for (const k of ['client', 'reviewer', 'developer', 'freelancer', 'target'] as const) {
    if (!isAddress(registration[k] ?? '')) return Response.json({ error: `${k} must be an address` }, { status: 400 })
  }
  if (![registration.client, registration.reviewer, registration.freelancer, registration.developer].some(a => same(a, caller))) {
    return Response.json({ error: 'Forbidden' }, { status: 403 })
  }
  const id = registrationId(registration)
  const existing = await loadPending(id)
  if (existing) return Response.json(existing)
  const pending = { id, registration: registrationToJson(registration), signatures: {} }
  await savePending(pending)
  return Response.json(pending)
}

/** A caller can list only their own pending signing requests. */
export async function GET(request: Request) {
  const caller = sessionAddress(request)
  if (!caller) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  const address = new URL(request.url).searchParams.get('address') ?? ''
  if (!isAddress(address)) return Response.json({ error: 'Address required' }, { status: 400 })
  if (!same(address, caller)) return Response.json({ error: 'Forbidden' }, { status: 403 })
  return Response.json(await pendingFor(caller))
}
