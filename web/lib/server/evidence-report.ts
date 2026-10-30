import { isAddress } from 'viem'

const HASH = /^0x[0-9a-f]{64}$/i
/** Minimum report-envelope validation. This does NOT authenticate CRE workflow identity or on-chain provenance. */
export function validReportEnvelope(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const r = value as Record<string, unknown>
  if (r.schema !== 'lexdiff/report@3' || typeof r.agreementId !== 'string' || !/^[1-9]\d{0,18}$/.test(r.agreementId)) return false
  if (typeof r.target !== 'string' || !isAddress(r.target)) return false
  if (typeof r.codeHash !== 'string' || !HASH.test(r.codeHash) || typeof r.termsHash !== 'string' || !HASH.test(r.termsHash)) return false
  if (typeof r.contractName !== 'string' || r.contractName.length > 256 || !Array.isArray(r.findings) || r.findings.length > 500) return false
  if (!r.onchain || typeof r.onchain !== 'object' || Array.isArray(r.onchain)) return false
  for (const item of r.findings) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return false
    const f = item as Record<string, unknown>
    if (typeof f.key !== 'string' || !HASH.test(f.key) || typeof f.detailsHash !== 'string' || !HASH.test(f.detailsHash)) return false
    if (![1, 2, 3].includes(Number(f.result))) return false
  }
  return true
}
