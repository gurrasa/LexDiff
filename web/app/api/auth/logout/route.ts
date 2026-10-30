import { NextResponse } from 'next/server'
import { SESSION_COOKIE, validOrigin } from '@/lib/server/wallet-session'
export async function POST(request: Request) {
  if (!validOrigin(request)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const response = NextResponse.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } })
  response.cookies.set(SESSION_COOKIE, '', { path: '/', maxAge: 0 })
  return response
}
