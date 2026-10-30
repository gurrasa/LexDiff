export type Role='client'|'freelancer'|'reviewer'|'developer'|'resolver'
export type TaskKind='review-clauses'|'approve-specification'|'acknowledge-finding'|'accept-remediation'|'respond-to-notice'|'assess-migration'|'review-dispute'
export type WorkflowTask={id:string;agreementId:string;kind:TaskKind;assignedRole:Role;state:'pending'|'accepted'|'contested'|'completed';dueAt?:string;sourceIds:string[];actorWallet?:string}
export function visibleTasks(tasks:readonly WorkflowTask[],role:Role,agreementId:string){return tasks.filter(t=>t.assignedRole===role&&t.agreementId===agreementId).map(t=>({...t,canAct:t.state==='pending'||t.state==='contested'}))}
export type ResolverSubmission={id:string;caseId:string;partyRole:'client'|'freelancer';statement:string;evidenceIds:string[];submittedAt:string}
export function validateResolverBundle(s:readonly ResolverSubmission[],authorized:boolean):{releasable:boolean;issues:string[]}{
 const issues:string[]=[];if(!authorized)issues.push('Resolver authorization missing');const ids=new Set<string>()
 for(const x of s){if(ids.has(x.id))issues.push(`Duplicate submission ${x.id}`);ids.add(x.id);if(!x.statement.trim()||x.evidenceIds.length===0)issues.push(`Submission lacks source evidence: ${x.id}`);if(!/Z$/.test(x.submittedAt)||!Number.isFinite(Date.parse(x.submittedAt)))issues.push(`UTC date invalid: ${x.id}`)}
 return {releasable:issues.length===0,issues}
}
