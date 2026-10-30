import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { keccak256, toBytes } from 'viem'
import { canonicalize, escrowTermsSchema } from '@/lib/terms'
import { evidenceKind, saveMetadata } from '@/lib/server/evidence-access'
import { isServiceRequest } from '@/lib/server/evidence-security'
import { validReportEnvelope } from '@/lib/server/evidence-report'
import { reportSafetyIssues } from '@/lib/verification/report-safety'
import { allowedCREAgreement } from '@/lib/server/production-gates'
import { sessionAddress, validOrigin } from '@/lib/server/wallet-session'

const DIR = process.env.EVIDENCE_DIR?.trim() || path.join(process.cwd(), 'data', 'evidence')
const MAX_BYTES = 256_000
const json = (error: string, status: number) => Response.json({ error }, { status, headers: { 'Cache-Control': 'no-store' } })
export async function POST(request: Request) {
  const declared = request.headers.get('content-length')
  if (declared && Number(declared) > MAX_BYTES) return json('Evidence too large', 413)
  // Bounds actual streamed bytes even when Content-Length is absent or dishonest.
  const reader = request.body?.getReader()
  if (!reader) return json('Body must be JSON', 400)
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > MAX_BYTES) { await reader.cancel(); return json('Evidence too large', 413) }
      chunks.push(value)
    }
  } catch { return json('Unable to read body', 400) }
  finally { reader.releaseLock() }
  let value: unknown
  try {
    const bytes = new Uint8Array(size)
    let offset = 0
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
    value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
  } catch { return json('Body must be JSON', 400) }

  const kind = evidenceKind(value)
  if (!kind) return json('Unsupported evidence schema', 400)
  const service = isServiceRequest(request)
  const address = kind === 'report' ? null : sessionAddress(request)
  if (kind === 'report') {
    if (!service) return json('Unauthorized', 401)
    if (!validReportEnvelope(value)) return json('Invalid report envelope', 400)
    if (reportSafetyIssues(value).length) return json('Report contains unsupported Pass claim', 400)
    if (!allowedCREAgreement((value as {agreementId: string}).agreementId)) return json('CRE report agreement not authorized', 403)
  } else {
    if (!address || !validOrigin(request)) return json('Unauthorized', 401)
    if (service) return json('CRE service may only upload reports', 403)
  }
  if (kind === 'terms') {
    const parsed = escrowTermsSchema.safeParse(value)
    if (!parsed.success) return json('Invalid escrow terms', 400)
    value = parsed.data
  }
  const canonical = canonicalize(value)
  const hash = keccak256(toBytes(canonical))
  await mkdir(DIR, { recursive: true })
  const file = path.join(DIR, `${hash}.json`)
  try {
    const existing = await readFile(file, 'utf8')
    if (existing !== canonical) return json('Immutable evidence conflict', 409)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    try { await writeFile(file, canonical, { flag: 'wx' }) }
    catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e
      if (await readFile(file, 'utf8') !== canonical) return json('Immutable evidence conflict', 409)
    }
  }
  try { await saveMetadata({ hash, kind, ...(address && kind !== 'report' ? { creator: address } : {}), created: new Date().toISOString() }) }
  catch { return json('Evidence ownership conflict', 409) }
  const base = process.env.PUBLIC_BASE_URL?.trim().replace(/\/+$/, '') || new URL(request.url).origin
  return Response.json({ hash, uri: `${base}/api/evidence/${hash}` }, { headers: { 'Cache-Control': 'no-store' } })
}
