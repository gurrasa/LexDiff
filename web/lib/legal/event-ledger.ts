/** Immutable event candidate validation; persistence and signatures must be enforced by callers. */
export type LegalEventKind = 'Receipt'|'RiskAcceptance'|'WaiverProposed'|'AmendmentProposed'|'AmendmentApproved'|'Dispute'|'DeveloperTaskAssigned'|'DeveloperTaskAccepted'|'NoticeSent'|'NoticeReceived'|'Response'|'IncidentReported'
export type LegalEvent = { id:string; agreementId:string; kind:LegalEventKind; actor:string; role:string; statementHash:string; occurredAt:string; evidenceHashes:string[]; references:string[] }
const H=/^0x[\da-f]{64}$/i; const A=/^0x[\da-f]{40}$/i
export function validateLegalEvent(e:LegalEvent):string[]{
 const issues:string[]=[]
 if(!e.id.trim()||!e.agreementId.trim())issues.push('Stable event and agreement IDs required')
 if(!A.test(e.actor))issues.push('Actor wallet invalid')
 if(!H.test(e.statementHash))issues.push('Exact statement hash invalid')
 if(!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z$/.test(e.occurredAt)||!Number.isFinite(Date.parse(e.occurredAt)))issues.push('UTC event time required')
 if(e.evidenceHashes.some(h=>!H.test(h)))issues.push('Invalid evidence hash')
 if(['AmendmentApproved','DeveloperTaskAccepted','NoticeReceived','Response'].includes(e.kind) && e.references.length===0)issues.push('Decision must reference its preceding event')
 return issues
}
export function deriveLegalTimeline(events:readonly LegalEvent[]){
 const issues:string[]=[];const ids=new Set<string>()
 for(const e of events){issues.push(...validateLegalEvent(e).map(s=>`${e.id}: ${s}`));if(ids.has(e.id))issues.push(`Duplicate event ID: ${e.id}`);ids.add(e.id)}
 for(const e of events)for(const ref of e.references)if(!ids.has(ref))issues.push(`${e.id}: missing referenced event ${ref}`)
 return {events:[...events].sort((a,b)=>a.occurredAt.localeCompare(b.occurredAt)||a.id.localeCompare(b.id)),issues}
}
/** A receipt cannot be treated as risk acceptance, amendment or settlement. */
export function legalEffect(kind:LegalEventKind):string{return ({Receipt:'Receipt only',RiskAcceptance:'Recorded risk position only; not amendment or waiver',WaiverProposed:'Proposed only',AmendmentProposed:'Proposed only',AmendmentApproved:'Recorded approval only; check required counterparties',Dispute:'Disputed; no adjudication',DeveloperTaskAssigned:'Assignment only; not accepted',DeveloperTaskAccepted:'Developer task accepted; no admission of liability',NoticeSent:'Notice sent; receipt not proven',NoticeReceived:'Receipt claimed; identity and delivery method require review',Response:'Party response; assertions unverified',IncidentReported:'Alleged incident; not established'} as Record<LegalEventKind,string>)[kind]}
