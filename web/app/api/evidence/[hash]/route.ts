import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { keccak256, toBytes } from 'viem'
import { canonicalize } from '@/lib/terms'
import { getMetadata, mayRead } from '@/lib/server/evidence-access'
import { auditEvidence } from '@/lib/server/evidence-audit'
import { sessionAddress } from '@/lib/server/wallet-session'
const DIR = process.env.EVIDENCE_DIR?.trim() || path.join(process.cwd(), 'data', 'evidence')
const HEADERS = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store, max-age=0', 'X-Content-Type-Options': 'nosniff' }
export async function GET(request: Request, ctx: RouteContext<'/api/evidence/[hash]'>) {
  const { hash } = await ctx.params
  if (!/^0x[0-9a-f]{64}$/.test(hash)) return Response.json({ error: 'Invalid evidence hash' }, { status: 400, headers: HEADERS })
  const metadata = await getMetadata(hash)
  const allowed = metadata ? await mayRead(request, metadata) : false
  const actor = sessionAddress(request) ?? (request.headers.has('authorization') ? 'service-token-present' : 'anonymous')
  try { await auditEvidence({ action: 'read', evidenceHash: hash, kind: metadata?.kind ?? 'unknown', outcome: allowed ? 'allowed' : 'denied', actor }) }
  catch { return Response.json({ error: 'Evidence audit unavailable' }, { status: 503, headers: HEADERS }) }
  if (!metadata || !allowed) return Response.json({ error: 'Not found' }, { status: 404, headers: HEADERS })
  let body: string
  try { body = await readFile(path.join(DIR, `${hash}.json`), 'utf8') }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return Response.json({ error: 'Not found' }, { status: 404, headers: HEADERS })
    return Response.json({ error: 'Evidence unavailable' }, { status: 500, headers: HEADERS })
  }
  try {
    const parsed: unknown = JSON.parse(body)
    if (keccak256(toBytes(canonicalize(parsed))) !== hash) throw new Error('Mismatch')
  } catch { return Response.json({ error: 'Evidence integrity failure' }, { status: 409, headers: HEADERS }) }
  return new Response(body, { status: 200, headers: HEADERS })
}
