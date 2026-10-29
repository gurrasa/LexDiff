// Minimal in-memory rate limit for a public demo: protects paid API calls (Claude) from casual abuse.
// Per server instance and reset on restart; not a substitute for real auth.

const hits = new Map<string, number[]>()

export function rateLimited(request: Request, limit: number, windowMs: number): boolean {
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'local'
  const now = Date.now()
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < windowMs)
  if (recent.length >= limit) return true
  recent.push(now)
  hits.set(ip, recent)
  return false
}
