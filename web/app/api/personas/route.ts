import { demoEnabled, PERSONAS, personaAccount } from '@/lib/personas'

/** Addresses of the presentation-mode identities, or 404 when presentation mode is off. */
export async function GET() {
  if (!demoEnabled()) return Response.json({ error: 'presentation mode is off' }, { status: 404 })
  return Response.json(Object.fromEntries(PERSONAS.map((p) => [p, personaAccount(p)!.address])))
}
