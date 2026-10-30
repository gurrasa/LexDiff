import {test} from 'node:test'
import assert from 'node:assert/strict'
import {evaluateActivation} from '../../lib/legal/activation'
test('a technically passing replacement with funds left behind is migration pending',()=>{
 const e = {oldTarget:'0x'+'1'.repeat(40),newTarget:'0x'+'2'.repeat(40),approvedByClient:true,approvedByCounterparty:true,specifiedChecksPassed:true,oldFundsMinor:BigInt(1000000000),newFundsMinor:BigInt(1000000000),escrowMigrationTx:'0x'+'3'.repeat(64),allowanceReviewed:true,rolesReviewed:true,incidentReviewComplete:true}
 const result = evaluateActivation(e)
 assert.equal(result.state,'MigrationPending');assert.match(result.blockers.join(' '),/still holds funds/)
})
