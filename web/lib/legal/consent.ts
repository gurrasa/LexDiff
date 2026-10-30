/** Legal consent policy. This is a preflight model, NOT enforced by the deployed Solidity registry. */
export type ActorRole = 'client'|'freelancer'|'reviewer'|'developer'
export type Action = 'initial-specification'|'material-amendment'|'replacement'|'receipt'|'risk-declaration'
export type Consent = { role: ActorRole; wallet: string; statementHash: string; signedAt: string; capacity: 'self'|'organization'|'unknown'; authorityEvidenceHash?: string }
export type ConsentResult = { permitted: boolean; blockers: string[] }
const wallet = (v: string) => /^0x[0-9a-f]{40}$/i.test(v)
const hash = (v: string) => /^0x[0-9a-f]{64}$/i.test(v)
export function evaluateConsent(action: Action, statementHash: string, expected: Record<ActorRole,string>, signatures: Consent[]): ConsentResult {
  const blockers: string[] = []
  if (!hash(statementHash)) blockers.push('Exact statement/version hash missing')
  const required: ActorRole[] = action === 'receipt' ? [] : action === 'risk-declaration' ? ['client'] : ['client','freelancer','reviewer']
  const used = new Set<string>()
  for (const role of required) {
    const actor = expected[role]
    if (!wallet(actor)) { blockers.push(`Unknown ${role} wallet`); continue }
    const found = signatures.find(s => s.role === role && s.wallet.toLowerCase() === actor.toLowerCase() && s.statementHash.toLowerCase() === statementHash.toLowerCase())
    if (!found) { blockers.push(`Missing exact-version approval by ${role}`); continue }
    if (used.has(actor.toLowerCase())) blockers.push(`Same wallet used for multiple required approvals: ${role}`)
    used.add(actor.toLowerCase())
    if (found.capacity === 'unknown') blockers.push(`Unestablished signer capacity: ${role}`)
    if (found.capacity === 'organization' && !found.authorityEvidenceHash) blockers.push(`Missing authority evidence: ${role}`)
  }
  // Signatures must be independently verified against the chain-specific EIP-712 domain before recording as consents.
  return { permitted: blockers.length === 0, blockers }
}
