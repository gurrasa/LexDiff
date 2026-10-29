import { readFile } from 'node:fs/promises'
import path from 'node:path'

const NOTES_DIR = process.env.EVIDENCE_DIR
  ? path.join(process.env.EVIDENCE_DIR, 'notes')
  : path.join(process.cwd(), 'data', 'notes')

export async function GET(_request: Request, ctx: { params: Promise<{ hash: string }> }) {
  const { hash } = await ctx.params
  if (!/^0x[0-9a-fA-F]{64}$/.test(hash)) return Response.json({ error: 'invalid note hash' }, { status: 400 })
  try {
    return new Response(await readFile(path.join(NOTES_DIR, `${hash.toLowerCase()}.txt`), 'utf8'), {
      headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'public, immutable, max-age=31536000' },
    })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return Response.json({ error: 'note not found' }, { status: 404 })
    throw error
  }
}
