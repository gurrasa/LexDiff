import { readFile } from 'node:fs/promises'
import path from 'node:path'
import type { Hex } from 'viem'
import { isPrivate, mayRead } from '@/lib/server/evidence-access'

const DIR = process.env.EVIDENCE_DIR?.trim() || path.join(process.cwd(), 'data', 'evidence')

export async function GET(request: Request, ctx: RouteContext<'/api/evidence/[hash]'>) {
  const { hash } = await ctx.params
  if (!/^0x[0-9a-f]{64}$/.test(hash)) return Response.json({ error: 'bad hash' }, { status: 400 })
  let body: string
  try {
    body = await readFile(path.join(DIR, `${hash}.json`), 'utf8')
  } catch {
    return Response.json({ error: 'not found' }, { status: 404 })
  }
  const hidden = isPrivate(JSON.parse(body))
  if (hidden && !(await mayRead(request, hash as Hex))) {
    return Response.json({ error: 'private to the parties of the agreement' }, { status: 403 })
  }
  return new Response(body, {
    headers: { 'content-type': 'application/json', 'cache-control': hidden ? 'private, no-store' : 'public, max-age=3600' },
  })
}
