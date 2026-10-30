import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { type Address, type Hex } from 'viem'
import { REGISTRY_ADDRESS, registry, same } from '@/lib/registry'
import { loadPending } from '@/lib/pending'
import { sessionAddress } from './wallet-session'
import { isServiceRequest } from './evidence-security'

const METADATA_DIR = process.env.EVIDENCE_METADATA_DIR?.trim() || path.join(process.cwd(), 'data', 'evidence-metadata')
export type EvidenceKind = 'agreement-document' | 'terms' | 'report' | 'decision-note'
type Metadata = { hash: Hex; kind: EvidenceKind; creator?: Address; created: string }
const HASH = /^0x[0-9a-f]{64}$/
export async function getMetadata(hash: string): Promise<Metadata | null> {
  if (!HASH.test(hash)) return null
  try { return JSON.parse(await readFile(path.join(METADATA_DIR, `${hash}.json`), 'utf8')) as Metadata } catch { return null }
}
export async function saveMetadata(metadata: Metadata): Promise<void> {
  await mkdir(METADATA_DIR, { recursive: true })
  const file = path.join(METADATA_DIR, `${metadata.hash}.json`)
  try { await writeFile(file, JSON.stringify(metadata), { flag: 'wx' }) }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
    const existing = await getMetadata(metadata.hash)
    if (!existing || existing.kind !== metadata.kind || (existing.creator ?? '').toLowerCase() !== (metadata.creator ?? '').toLowerCase()) {
      throw new Error('Evidence ownership conflict')
    }
  }
}
export async function mayRead(request: Request, metadata: Metadata): Promise<boolean> {
  // CRE must only fetch structured terms, never legal documents, decisions, or reports.
  if (isServiceRequest(request)) return metadata.kind === 'terms'
  const address = sessionAddress(request)
  if (!address) return false
  if (metadata.creator && same(address, metadata.creator)) return true
  // On-chain link can authorize parties, but NEVER use an arbitrary caller-supplied agreement ID alone.
  if (!REGISTRY_ADDRESS) return false
  const caseId = new URL(request.url).searchParams.get('agreementId')
  if (caseId && /^(0|[1-9]\d{0,19})$/.test(caseId)) {
    try {
      const a = await registry.getAgreement(BigInt(caseId))
      const linked = metadata.kind === 'terms' ? sameHash(a.termsHash, metadata.hash)
        : metadata.kind === 'agreement-document' ? sameHash(a.agreementHash, metadata.hash)
        : metadata.kind === 'report' ? (await registry.getChecks(BigInt(caseId))).some(c => sameHash(c.reportHash, metadata.hash))
        : (await registry.getDecisions(BigInt(caseId), (new URL(request.url).searchParams.get('findingKey') ?? '') as Hex)).some(d => sameHash(d.noteHash, metadata.hash))
      if (linked && [a.client, a.freelancer, a.reviewer, a.developer].some(role => same(role, address))) return true
    } catch { /* fail closed */ }
  }
  // Pending agreements require a signed-in participant, not simply knowledge of the signing link.
  const pendingId = new URL(request.url).searchParams.get('registrationId')
  if (pendingId && HASH.test(pendingId) && (metadata.kind === 'terms' || metadata.kind === 'agreement-document')) {
    const p = await loadPending(pendingId)
    if (p && (metadata.kind === 'terms' ? sameHash(p.registration.termsHash, metadata.hash) : sameHash(p.registration.agreementHash, metadata.hash))) {
      return [p.registration.client, p.registration.freelancer, p.registration.reviewer, p.registration.developer].some(role => same(role, address))
    }
  }
  return false
}
function sameHash(a: string, b: string) { return a.toLowerCase() === b.toLowerCase() }
export function evidenceKind(value: unknown): EvidenceKind | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const o = value as { schema?: unknown; note?: unknown }
  if (o.schema === 'lexdiff/report@3') return 'report'
  if (o.schema === 'lexdiff/agreement-document@1') return 'agreement-document'
  if (o.schema === 'lexdiff/escrow-terms@1') return 'terms'
  if (typeof o.note === 'string' && Object.keys(o).length === 1) return 'decision-note'
  return null
}
