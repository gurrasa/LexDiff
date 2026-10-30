/** Data handling defaults; actual deletion requires a durable evidence store and audited erasure API. */
export type DataClass = 'public-chain'|'private-document'|'technical-report'|'legal-advice'|'dispute-submission'
export type RetentionAssessment = { canDelete: boolean; reasons: string[] }
export function assessOffchainErasure(kind:DataClass, legalHold:boolean, activeCase:boolean):RetentionAssessment {
 const reasons:string[]=[]
 if(kind==='public-chain') reasons.push('Immutable chain data cannot be erased off-chain')
 if(legalHold) reasons.push('Legal hold in effect')
 if(activeCase) reasons.push('Active case requires evidence retention review')
 return {canDelete:reasons.length===0,reasons}
}
