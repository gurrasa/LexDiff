import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { canonicalize, escrowTermsSchema, termsHash } from '@/lib/terms'

const TERMS_DIR = path.join(process.cwd(), 'data', 'terms')

/** Publishes reviewed terms. The CRE workflow fetches them from the returned URI and checks the hash. */
export async function POST(request: Request) {
  const parsed = escrowTermsSchema.safeParse(await request.json())
  if (!parsed.success) return Response.json({ error: parsed.error.message }, { status: 400 })

  const hash = termsHash(parsed.data)
  await mkdir(TERMS_DIR, { recursive: true })
  await writeFile(path.join(TERMS_DIR, `${hash}.json`), canonicalize(parsed.data))

  const base = process.env.PUBLIC_BASE_URL || new URL(request.url).origin
  return Response.json({ hash, uri: `${base}/api/terms/${hash}` })
}
