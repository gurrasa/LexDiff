import {test} from 'node:test';import assert from 'node:assert/strict'
import {approveNarrative,makeNarrativeDraft,submissionIssues} from '../../lib/legal/resolver-case'
const h='0x'+'e'.repeat(64);const reviewer='0x'+'a'.repeat(40)
test('draft is not approved until separate named reviewer action',()=>{
 const draft=makeNarrativeDraft('1','The supplied record alleges a missed deadline.',[h]);assert.equal(draft.status,'Draft')
 assert.throws(()=>approveNarrative({...draft,text:'Changed claim'},reviewer,'2026-01-01T00:00:00Z'))
 assert.equal(approveNarrative(draft,reviewer,'2026-01-01T00:00:00Z').status,'Approved')
})
test('resolver submissions require verifiable cited sources',()=>{
 assert.ok(submissionIssues({id:'x',agreementId:'1',author:reviewer,role:'resolver',kind:'Claim',statement:'Unverified allegation',sourceHashes:[],submittedAt:'2026-01-01T00:00:00Z'}).length>0)
})
