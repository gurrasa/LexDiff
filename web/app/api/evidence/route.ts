<<<<<<< HEAD
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { keccak256, toBytes } from 'viem'
import { canonicalize, escrowTermsSchema } from '@/lib/terms'

// Content-addressed evidence store for everything that must not live on-chain in plaintext:
// reviewed terms, CRE report documents and decision notes. Each item is stored as canonical JSON
// under keccak256(canonical), which is exactly the hash anchored on-chain.

const DIR = path.join(process.cwd(), 'data', 'evidence')

export async function POST(request: Request) {
  let value: unknown
  try {
    value = await request.json()
  } catch {
    return Response.json({ error: 'body must be JSON' }, { status: 400 })
  }
  if (value && typeof value === 'object' && (value as { schema?: string }).schema === 'lexdiff/escrow-terms@1') {
    const parsed = escrowTermsSchema.safeParse(value)
    if (!parsed.success) return Response.json({ error: parsed.error.message }, { status: 400 })
    value = parsed.data
  }

  const canonical = canonicalize(value)
  const hash = keccak256(toBytes(canonical))
  await mkdir(DIR, { recursive: true })
  await writeFile(path.join(DIR, `${hash}.json`), canonical)

=======
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { keccak256, toBytes } from 'viem'
import { canonicalize } from '@/lib/terms'

const EVIDENCE_DIR = process.env.EVIDENCE_DIR || path.join(process.cwd(), 'data', 'evidence')

export async function POST(request: Request) {
  const report = await request.json()
  if (report?.schema !== 'lexdiff/evidence-report@1') {
    return Response.json({ error: 'unsupported evidence report schema' }, { status: 400 })
  }
  const canonical = canonicalize(report)
  const hash = keccak256(toBytes(canonical))
  await mkdir(EVIDENCE_DIR, { recursive: true })
  const file = path.join(EVIDENCE_DIR, `${hash}.json`)
  try {
    const existing = await readFile(file, 'utf8')
    if (existing !== canonical) return Response.json({ error: 'hash collision or immutable evidence conflict' }, { status: 409 })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    await writeFile(file, canonical, { flag: 'wx' })
  }
>>>>>>> df31607 (Align LexDiff with evidence-first design)
  const base = process.env.PUBLIC_BASE_URL || new URL(request.url).origin
  return Response.json({ hash, uri: `${base}/api/evidence/${hash}` })
}
