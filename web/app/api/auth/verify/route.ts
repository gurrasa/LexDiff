import { NextResponse } from 'next/server'
import { publicClient } from '@/lib/registry'
import { addressOf, consumeChallenge, cookie, makeSession, NONCE_COOKIE, secureCookie, SESSION_COOKIE, validOrigin } from '@/lib/server/wallet-session'
import type { Hex } from 'viem'
export async function POST(request: Request) {
  if (!validOrigin(request)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  let input: { address?: unknown; message?: unknown; signature?: unknown }
  try { input = await request.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }
  const address = addressOf(input?.address)
  if (!address || typeof input?.message !== 'string' || input.message.length > 1024 ||
      typeof input?.signature !== 'string' || !/^0x[0-9a-f]{130}$/i.test(input.signature)) {
    return NextResponse.json({ error: 'Invalid sign-in payload' }, { status: 400 })
  }
  const nonce = cookie(request, NONCE_COOKIE)
  if (!nonce || !consumeChallenge(nonce, address, input.message)) return NextResponse.json({ error: 'Challenge expired or used' }, { status: 401 })
  try {
    if (!await publicClient.verifyMessage({ address, message: input.message, signature: input.signature as Hex })) {
      return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
    }
    const response = NextResponse.json({ address }, { headers: { 'Cache-Control': 'no-store' } })
    response.cookies.set(SESSION_COOKIE, makeSession(address), { httpOnly: true, sameSite: 'strict', secure: secureCookie, maxAge: 3600, path: '/' })
    response.cookies.set(NONCE_COOKIE, '', { path: '/api/auth', maxAge: 0 })
    return response
  } catch { return NextResponse.json({ error: 'Signature verification failed' }, { status: 503 }) }
}
