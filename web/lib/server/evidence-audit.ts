/** Append-only local access audit. A shared, durable audit backend is required for production. */
import { appendFile, mkdir } from 'node:fs/promises'
import path from 'node:path'
import { createHash } from 'node:crypto'

export type EvidenceAuditEvent = { action: 'read'; evidenceHash: string; kind: string; outcome: 'allowed'|'denied'|'missing'|'integrity_failure'; actor: string }
export function evidenceAuditLine(event: EvidenceAuditEvent, at = new Date().toISOString()): string {
  if (!/^0x[0-9a-f]{64}$/i.test(event.evidenceHash)) throw new Error('Invalid hash')
  const actorDigest = createHash('sha256').update(event.actor).digest('hex')
  return JSON.stringify({ at, action: event.action, hash: event.evidenceHash, kind: event.kind, outcome: event.outcome, actorDigest }) + '\n'
}
export async function auditEvidence(event: EvidenceAuditEvent): Promise<void> {
  const directory = process.env.LEXDIFF_EVIDENCE_AUDIT_DIR?.trim()
  if (!directory) {
    if (process.env.NODE_ENV === 'production') throw new Error('Durable evidence access audit backend not configured')
    return
  }
  await mkdir(directory,{recursive:true})
  await appendFile(path.join(directory,'evidence-access.jsonl'),evidenceAuditLine(event),{flag:'a',mode:0o600})
}
