/** Fail-closed deployment gates. Do not confuse an HTTP token with authenticated CRE provenance. */
export type DeploymentGate = { ok: boolean; blockers: string[] }
export function productionGate(env: Record<string, string | undefined>, production = env.NODE_ENV === 'production'): DeploymentGate {
  if (!production) return { ok: true, blockers: [] }
  const blockers: string[] = []
  if (!/^[0-9a-fA-F]{64}$/.test(env.LEXDIFF_SESSION_SECRET ?? '')) blockers.push('Missing 32-byte session HMAC key')
  if (!env.LEXDIFF_EVIDENCE_API_TOKEN || env.LEXDIFF_EVIDENCE_API_TOKEN.length < 32) blockers.push('Missing strong CRE evidence API token')
  if (!env.EVIDENCE_DIR || !env.EVIDENCE_METADATA_DIR) blockers.push('Durable evidence storage locations not configured')
  if (!env.LEXDIFF_CRE_ALLOWED_AGREEMENT_IDS?.trim()) blockers.push('CRE report upload allowlist is empty')
  // Even all of these being present does not demonstrate shared storage or production DON identity.
  return { ok: blockers.length === 0, blockers }
}
export function allowedCREAgreement(agreementId: string, env: Record<string, string | undefined> = process.env): boolean {
  if (!/^[1-9]\d*$/.test(agreementId)) return false
  const ids = (env.LEXDIFF_CRE_ALLOWED_AGREEMENT_IDS ?? '').split(',').map(x => x.trim())
  if (env.NODE_ENV === 'production' && !ids.some(Boolean)) return false
  return ids.some(x => x === agreementId) || (env.NODE_ENV !== 'production' && ids.every(x => !x))
}
