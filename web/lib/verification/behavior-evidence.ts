/** Conservative property-level evidence assessment, not an EVM simulator. */
export type CheckResult='Pass'|'Fail'|'Inconclusive'|'NotChecked'
export type Scenario={id:string;kind:'positive'|'negative';caller:string;token:string;recipient:string;amountMinor:string;timeBoundary:string;txHash?:string;execution:'observed-success'|'observed-revert'|'not-run';expected:'success'|'revert'}
export type RuntimeProvenance={chainId:number;target:string;blockNumber:string;runtimeCodeHash:string;checkerVersion:string;proxyImplementation?:string|null;proxyImplementationCodeHash?:string|null}
const A=/^0x[0-9a-f]{40}$/i,H=/^0x[0-9a-f]{64}$/i
export function validateRuntime(p:RuntimeProvenance):string[]{const b:string[]=[];if(!Number.isSafeInteger(p.chainId)||p.chainId<=0)b.push('Missing chain');if(!A.test(p.target))b.push('Invalid target');if(!/^\d+$/.test(p.blockNumber))b.push('Missing block');if(!H.test(p.runtimeCodeHash))b.push('Runtime hash missing');if(!p.checkerVersion.trim())b.push('Checker version missing');if(p.proxyImplementation && (!A.test(p.proxyImplementation)||!H.test(p.proxyImplementationCodeHash??'')))b.push('Proxy implementation provenance incomplete');return b}
export function evaluateBehavior(scenarios:readonly Scenario[],provenance:RuntimeProvenance,requiredIds:readonly string[]):{result:CheckResult;issues:string[]}{
 const issues=validateRuntime(provenance);const ids=new Set<string>();let mismatch=false
 for(const s of scenarios){if(ids.has(s.id))issues.push(`Duplicate scenario: ${s.id}`);ids.add(s.id);if(!s.caller||!s.token||!s.recipient||!/^\d+$/.test(s.amountMinor)||!s.timeBoundary)issues.push(`Scenario context incomplete: ${s.id}`);if(s.execution==='not-run'||!H.test(s.txHash??''))issues.push(`No execution proof: ${s.id}`);else if((s.execution==='observed-success'?'success':'revert')!==s.expected)mismatch=true}
 for(const id of requiredIds)if(!ids.has(id))issues.push(`Missing scenario: ${id}`)
 if(mismatch)return {result:'Fail',issues:[...issues,'Observed behavior conflicts with expected behavior']}
 if(scenarios.length===0)return {result:'NotChecked',issues:[...issues,'No scenarios supplied']}
 if(issues.length)return {result:'Inconclusive',issues}
 if(!scenarios.some(s=>s.kind==='positive')||!scenarios.some(s=>s.kind==='negative'))return {result:'Inconclusive',issues:['Both positive and negative scenarios required']}
 return {result:'Pass',issues:[]}
}
