import {keccak256,toBytes} from 'viem'
import {canonicalize} from '../terms'
export type AssertionClass='contract_text'|'technical_observation'|'party_statement'|'legal_question'
export type CaseAssertion={id:string;classification:AssertionClass;narrative:string;evidenceIds:string[];verification:'verified'|'unverified'|'conflicted'|'not_applicable';limitations:string[]}
export type SnapshotSource={id:string;hash:string;available:boolean;verified:boolean;classification:'public-technical'|'shared-contract'|'confidential'|'privileged'}
const H=/^0x[0-9a-f]{64}$/i
/** Prevents unsupported evidence claims and preserves adverse assertions in a cutoff snapshot. */
export function validateCaseAssertions(assertions:readonly CaseAssertion[],sources:readonly SnapshotSource[]):string[]{
 const issues:string[]=[];const ids=new Set(sources.map(s=>s.id));const seen=new Set<string>()
 for(const a of assertions){if(!a.id||seen.has(a.id))issues.push(`Duplicate/missing assertion ID: ${a.id}`);seen.add(a.id);if(!a.narrative.trim())issues.push(`Empty assertion: ${a.id}`);if(a.classification!=='legal_question'&&a.evidenceIds.length===0)issues.push(`Unreferenced assertion: ${a.id}`);for(const id of a.evidenceIds)if(!ids.has(id))issues.push(`Missing source for ${a.id}: ${id}`);if(a.classification==='legal_question'&&a.verification==='verified')issues.push(`Legal conclusion cannot be machine-verified: ${a.id}`)}
 return issues
}
export function freezeCaseSnapshot(input:{caseId:string;cutoff:string;assertions:CaseAssertion[];sources:SnapshotSource[]}){
 if(!input.caseId.trim()||!Number.isFinite(Date.parse(input.cutoff)))throw new Error('Invalid cutoff or case ID')
 const issues=validateCaseAssertions(input.assertions,input.sources)
 const orderedSources=[...input.sources].sort((a,b)=>a.id.localeCompare(b.id))
 for(const s of orderedSources){if(!H.test(s.hash))issues.push(`Invalid hash: ${s.id}`);if(!s.available)issues.push(`Evidence unavailable: ${s.id}`);else if(!s.verified)issues.push(`Evidence not independently verified: ${s.id}`)}
 const orderedAssertions=[...input.assertions].sort((a,b)=>a.id.localeCompare(b.id))
 const sourceHash=keccak256(toBytes(canonicalize({caseId:input.caseId,cutoff:input.cutoff,sources:orderedSources,assertions:orderedAssertions})))
 return {schemaVersion:'lexdiff/case-snapshot@1',caseId:input.caseId,cutoff:input.cutoff,sourceHash,assertions:orderedAssertions,sources:orderedSources,warnings:issues,complete:issues.length===0}
}
