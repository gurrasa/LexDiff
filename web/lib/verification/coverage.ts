/** Every material clause needs an explicit, supported outcome; no coverage inferred from absence. */
export type Method = 'onchain-read'|'source-structure'|'behavioral-simulation'|'external-fact'|'legal-judgment'|'unsupported'
export type Outcome = 'Pass'|'Fail'|'Inconclusive'|'NotChecked'
export type RequirementEvidence = { clauseId: string; quote: string; reviewer?: string; method: Method; result: Outcome; evidenceHashes: string[]; codeHash?: string; blockNumber?: string; limitations: string[] }
export function validateCoverage(requirements: RequirementEvidence[]): string[] {
 const issues:string[]=[]; const ids=new Set<string>()
 for (const [i,r] of requirements.entries()) {
  if (!r.clauseId || ids.has(r.clauseId)) issues.push(`Duplicate or missing clause ID at ${i}`)
  ids.add(r.clauseId)
  if (!r.quote.trim()) issues.push(`Missing verbatim clause: ${r.clauseId}`)
  if (!r.reviewer) issues.push(`Clause not reviewed: ${r.clauseId}`)
  if (r.result === 'Pass' && (r.method === 'source-structure' || r.method === 'external-fact' || r.method === 'legal-judgment' || r.method === 'unsupported')) issues.push(`Unsupported Pass: ${r.clauseId}`)
  if (r.result === 'Pass' && r.evidenceHashes.length === 0) issues.push(`Pass without evidence: ${r.clauseId}`)
  if ((r.method === 'onchain-read' || r.method === 'behavioral-simulation') && r.result === 'Pass' && (!r.codeHash || !r.blockNumber)) issues.push(`Pass without code/block provenance: ${r.clauseId}`)
 }
 return issues
}
export function completenessSummary(items: RequirementEvidence[]) {
 const outcomes:Record<Outcome,number>={Pass:0,Fail:0,Inconclusive:0,NotChecked:0}
 for (const x of items) outcomes[x.result]++
 return { outcomes, reviewWarnings: validateCoverage(items), materialClauses: items.length }
}
