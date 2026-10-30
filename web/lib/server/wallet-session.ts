import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { getAddress, isAddress, type Address } from 'viem'

export const SESSION_COOKIE = 'lexdiff_session'
export const NONCE_COOKIE = 'lexdiff_nonce'
const TTL = 3600_000
export const nonceStore = new Map<string, { address: Address; message: string; expires: number }>()

function secret(): Buffer {
  const value = process.env.LEXDIFF_SESSION_SECRET
  if (!value || !/^[a-f0-9]{64}$/i.test(value)) throw new Error('Missing LEXDIFF_SESSION_SECRET')
  return Buffer.from(value, 'hex')
}
export function validOrigin(request: Request): boolean {
  const origin = request.headers.get('origin')
  return origin !== null && origin === new URL(request.url).origin
}
export function addressOf(value: unknown): Address | null {
  return typeof value === 'string' && isAddress(value) ? getAddress(value) : null
}
export function cookie(request: Request, name: string): string | null {
  const entry = (request.headers.get('cookie') ?? '').split(';').map(p => p.trim()).find(p => p.startsWith(`${name}=`))
  return entry ? entry.slice(name.length + 1) : null
}
export function challenge(address: Address, origin: string) {
  secret()
  const nonce = randomBytes(32).toString('hex')
  const expires = Date.now() + 300_000
  const message = `LexDiff wallet sign-in\nOrigin: ${origin}\nAddress: ${address}\nChain ID: 11155111\nNonce: ${nonce}\nExpires: ${new Date(expires).toISOString()}\nNo blockchain transaction is requested.`
  // Development only: replace with an atomic, shared TTL store in production.
  nonceStore.set(nonce, { address, message, expires })
  return { nonce, message }
}
export function consumeChallenge(nonce: string, address: Address, message: string): boolean {
  if (!/^[0-9a-f]{64}$/.test(nonce)) return false
  const item = nonceStore.get(nonce)
  nonceStore.delete(nonce)
  return !!item && item.expires > Date.now() && item.address === address && item.message === message
}
export function makeSession(address: Address): string {
  const payload = Buffer.from(JSON.stringify({ address, expires: Date.now() + TTL })).toString('base64url')
  const mac = createHmac('sha256', secret()).update(payload).digest('base64url')
  return `${payload}.${mac}`
}
export function sessionAddress(request: Request): Address | null {
  const value = cookie(request, SESSION_COOKIE)
  if (!value || value.length > 2048) return null
  const [payload, mac, extra] = value.split('.')
  if (!payload || !mac || extra) return null
  const key = process.env.LEXDIFF_SESSION_SECRET
  if (!key || !/^[0-9a-f]{64}$/i.test(key)) return null
  const expected = createHmac('sha256', Buffer.from(key, 'hex')).update(payload).digest()
  const supplied = Buffer.from(mac, 'base64url')
  if (supplied.length !== expected.length || !timingSafeEqual(expected, supplied)) return null
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as { address: unknown; expires: number }
    return typeof data.expires === 'number' && data.expires > Date.now() && data.expires <= Date.now() + TTL ? addressOf(data.address) : null
  } catch { return null }
}
export const secureCookie = process.env.NODE_ENV === 'production'
