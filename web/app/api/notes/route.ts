import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { keccak256, toBytes } from 'viem'

const NOTES_DIR = process.env.EVIDENCE_DIR
  ? path.join(process.env.EVIDENCE_DIR, 'notes')
  : path.join(process.cwd(), 'data', 'notes')

export async function POST(request: Request) {
  const { note } = await request.json() as { note?: unknown }
  if (typeof note !== 'string' || !note.trim()) return Response.json({ error: 'note is required' }, { status: 400 })
  if (note.length > 10_000) return Response.json({ error: 'note is too long' }, { status: 413 })
  const hash = keccak256(toBytes(note))
  await mkdir(NOTES_DIR, { recursive: true })
  const file = path.join(NOTES_DIR, `${hash}.txt`)
  try {
    const existing = await readFile(file, 'utf8')
    if (existing !== note) return Response.json({ error: 'immutable note conflict' }, { status: 409 })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    await writeFile(file, note, { flag: 'wx' })
  }
  return Response.json({ hash })
}
