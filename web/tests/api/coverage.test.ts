import {test} from 'node:test'
import assert from 'node:assert/strict'
import {validateCoverage,completenessSummary} from '../../lib/verification/coverage'
test('structural observations cannot make contractual behavioral claims pass',()=>{
 const r={clauseId:'c1',quote:'refund on missed deadline',reviewer:'0xreviewer',method:'source-structure' as const,result:'Pass' as const,evidenceHashes:[],limitations:[]}
 assert.match(validateCoverage([r]).join(';'),/Unsupported Pass/)
})
test('missing checks remain NotChecked',()=>{
 const r={clauseId:'c1',quote:'refund',method:'unsupported' as const,result:'NotChecked' as const,evidenceHashes:[],limitations:['untested']}
 assert.equal(completenessSummary([r]).outcomes.NotChecked,1)
})
