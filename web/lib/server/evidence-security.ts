import { timingSafeEqual } from 'node:crypto'
export function bearerToken(request: Request): string | null {
  const header = request.headers.get('authorization')
  if (!header?.startsWith('Bearer ')) return null
  const token = header.slice(7)
  return token && !/\s/.test(token) ? token : null
}
export function isServiceRequest(request: Request): boolean {
  const secret = process.env.LEXDIFF_EVIDENCE_API_TOKEN
  const supplied = bearerToken(request)
  if (!secret || secret.length < 32 || !supplied) return false
  const a = Buffer.from(secret), b = Buffer.from(supplied)
  return a.length === b.length && timingSafeEqual(a, b)
}
