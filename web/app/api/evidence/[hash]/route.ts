import { readFile } from 'node:fs/promises'
import path from 'node:path'

export async function GET(_request: Request, ctx: RouteContext<'/api/evidence/[hash]'>) {
  const { hash } = await ctx.params
  if (!/^0x[0-9a-f]{64}$/.test(hash)) return Response.json({ error: 'bad hash' }, { status: 400 })
  try {
    const body = await readFile(path.join(process.cwd(), 'data', 'evidence', `${hash}.json`), 'utf8')
    return new Response(body, { headers: { 'content-type': 'application/json' } })
  } catch {
    return Response.json({ error: 'not found' }, { status: 404 })
  }
}
