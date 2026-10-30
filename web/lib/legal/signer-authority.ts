export type Capacity='individual'|'director'|'agent'|'trustee'|'unknown'
export type AuthorityRecord={agreementId:string;wallet:string;legalName:string;capacity:Capacity;entityId?:string;authorityEvidenceHash?:string;validFrom:string;validUntil?:string;verifiedBy?:string;verifiedAt?:string;sourceDescription?:string}
const SHA=/^0x[0-9a-f]{64}$/i;const ADDRESS=/^0x[0-9a-f]{40}$/i
export function authorityIssues(r:AuthorityRecord,at:string):string[]{
 const issues:string[]=[]
 if(!ADDRESS.test(r.wallet))issues.push('Invalid wallet')
 if(!r.legalName.trim())issues.push('Unknown legal identity')
 if(r.capacity==='unknown')issues.push('Capacity unverified')
 if(['director','agent','trustee'].includes(r.capacity)&&!r.entityId?.trim())issues.push('Represented entity unspecified')
 if(!r.authorityEvidenceHash||!SHA.test(r.authorityEvidenceHash))issues.push('No verifiable authority source')
 if(!r.verifiedBy||!r.verifiedAt)issues.push('Independent authority review missing')
 const now=Date.parse(at),start=Date.parse(r.validFrom),end=r.validUntil?Date.parse(r.validUntil):Infinity
 if(!Number.isFinite(now)||!Number.isFinite(start)||now<start||now>end)issues.push('Authority outside effective period')
 if(r.verifiedAt&&(!Number.isFinite(Date.parse(r.verifiedAt))||Date.parse(r.verifiedAt)>now))issues.push('Invalid review timestamp')
 return issues
}
export function independentSigners(signers:readonly AuthorityRecord[]):boolean{
 const wallets=signers.map(s=>s.wallet.toLowerCase())
 return wallets.every(w=>ADDRESS.test(w))&&new Set(wallets).size===wallets.length
}
