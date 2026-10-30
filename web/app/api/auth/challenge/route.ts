import { NextResponse } from 'next/server'
import { addressOf, challenge, NONCE_COOKIE, secureCookie, validOrigin } from '@/lib/server/wallet-session'
export async function POST(request: Request) {
  if (!validOrigin(request)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  let data: { address?: unknown }
  try { data = await request.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }
  const address = addressOf(data?.address)
  if (!address) return NextResponse.json({ error: 'Invalid wallet' }, { status: 400 })
  try {
    const { nonce, message } = challenge(address, new URL(request.url).origin)
    const response = NextResponse.json({ message }, { headers: { 'Cache-Control': 'no-store' } })
    response.cookies.set(NONCE_COOKIE, nonce, { httpOnly: true, sameSite: 'strict', secure: secureCookie, maxAge: 300, path: '/api/auth' })
    return response
  } catch { return NextResponse.json({ error: 'Authentication unavailable' }, { status: 503 }) }
}
