import {createHash} from 'node:crypto'
export type ResolverSubmission={id:string;agreementId:string;author:string;role:'client'|'freelancer'|'reviewer'|'developer'|'resolver';kind:'Claim'|'Response'|'Evidence'|'ProceduralNote';statement:string;sourceHashes:string[];submittedAt:string}
export type NarrativeDraft={caseId:string;text:string;sources:string[];status:'Draft'|'Approved';approvedBy?:string;approvedAt?:string;draftHash:string}
const hash=/^0x[0-9a-f]{64}$/i
export function submissionIssues(s:ResolverSubmission){
 const issues:string[]=[]
 if(!s.id.trim()||!s.agreementId.trim()||!s.author.trim())issues.push('Submission identity missing')
 if(!s.statement.trim())issues.push('Empty statement')
 if(!s.sourceHashes.length||s.sourceHashes.some(h=>!hash.test(h)))issues.push('Source evidence missing or malformed')
 if(!Number.isFinite(Date.parse(s.submittedAt)))issues.push('Invalid submission time')
 return issues
}
export function makeNarrativeDraft(caseId:string,text:string,sources:string[]):NarrativeDraft{
 if(!caseId||!text.trim()||sources.length===0||sources.some(h=>!hash.test(h)))throw new Error('Source-grounded draft required')
 const draftHash=createHash('sha256').update(JSON.stringify({caseId,text,sources})).digest('hex')
 return {caseId,text,sources,status:'Draft',draftHash}
}
/** Human approval is explicit, separate and tied to the exact text+source digest. */
export function approveNarrative(d:NarrativeDraft,reviewer:string,at:string):NarrativeDraft{
 if(!/^0x[0-9a-f]{40}$/i.test(reviewer)||!Number.isFinite(Date.parse(at))||d.status!=='Draft')throw new Error('Human reviewer and fresh draft required')
 const fingerprint=createHash('sha256').update(JSON.stringify({caseId:d.caseId,text:d.text,sources:d.sources})).digest('hex')
 if(fingerprint!==d.draftHash)throw new Error('Draft modified after preparation')
 return {...d,status:'Approved',approvedBy:reviewer,approvedAt:at}
}
