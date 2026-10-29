import { isAddress } from 'viem'
import { loadPending, registrationId, savePending } from '@/lib/pending'
import { registrationFromJson, registrationToJson } from '@/lib/registry'

/** Creates (or returns) a pending registration that the reviewer and client sign via /sign/[id]. */
export async function POST(request: Request) {
  if (Number(request.headers.get('content-length') ?? 0) > 16_000) {
    return Response.json({ error: 'registration too large' }, { status: 413 })
  }
  const body = (await request.json()) as { registration?: Record<string, unknown> }
  let registration
  try {
    registration = registrationFromJson(body.registration ?? {})
  } catch {
    return Response.json({ error: 'invalid registration' }, { status: 400 })
  }
  for (const k of ['client', 'reviewer', 'developer', 'freelancer', 'target'] as const) {
    if (!isAddress(registration[k] ?? '')) return Response.json({ error: `${k} must be an address` }, { status: 400 })
  }
  const id = registrationId(registration)
  const existing = await loadPending(id)
  if (existing) return Response.json(existing)
  const pending = { id, registration: registrationToJson(registration), signatures: {} }
  await savePending(pending)
  return Response.json(pending)
}
