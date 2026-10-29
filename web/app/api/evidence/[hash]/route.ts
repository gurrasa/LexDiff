import { readFile } from 'node:fs/promises'
import path from 'node:path'

<<<<<<< HEAD
export async function GET(_request: Request, ctx: RouteContext<'/api/evidence/[hash]'>) {
  const { hash } = await ctx.params
  if (!/^0x[0-9a-f]{64}$/.test(hash)) return Response.json({ error: 'bad hash' }, { status: 400 })
  try {
    const body = await readFile(path.join(process.cwd(), 'data', 'evidence', `${hash}.json`), 'utf8')
    return new Response(body, { headers: { 'content-type': 'application/json' } })
  } catch {
    return Response.json({ error: 'not found' }, { status: 404 })
=======
const EVIDENCE_DIR = process.env.EVIDENCE_DIR || path.join(process.cwd(), 'data', 'evidence')

export async function GET(_request: Request, ctx: RouteContext<'/api/evidence/[hash]'>) {
  const { hash } = await ctx.params
  if (!/^0x[0-9a-fA-F]{64}$/.test(hash)) return Response.json({ error: 'invalid evidence hash' }, { status: 400 })
  try {
    const contents = await readFile(path.join(EVIDENCE_DIR, `${hash.toLowerCase()}.json`), 'utf8')
    return new Response(contents, {
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'content-disposition': `attachment; filename="lexdiff-evidence-${hash}.json"`,
        'cache-control': 'public, immutable, max-age=31536000',
      },
    })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return Response.json({ error: 'evidence not found' }, { status: 404 })
    throw error
>>>>>>> df31607 (Align LexDiff with evidence-first design)
  }
}
