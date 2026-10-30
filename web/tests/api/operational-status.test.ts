import {test} from 'node:test'
import {strict as assert} from 'node:assert'
import {operationalState} from '../../lib/legal/operational-status'
test('registered replacement never implies active funding migration',()=>{
 assert.equal(operationalState({replacementRegistered:true,migrationVerified:false,affectedConsentVerified:true,technicalChecksPassed:true}),'MigrationPending')
 assert.equal(operationalState({replacementRegistered:true,migrationVerified:true,affectedConsentVerified:true,technicalChecksPassed:true}),'ReadyForManualActivation')
})
