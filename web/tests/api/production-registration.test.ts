import {test} from 'node:test'
import {strict as assert} from 'node:assert'
import {productionRegistrationPermitted} from '../../lib/legal/production-registration'
test('production cannot register without a consent-enforcing registry migration',()=>{
 assert.equal(productionRegistrationPermitted({NODE_ENV:'production'}),false)
 assert.equal(productionRegistrationPermitted({NODE_ENV:'production',LEXDIFF_ALLOW_UNSAFE_REGISTRATION:'true'}),false)
 assert.equal(productionRegistrationPermitted({NODE_ENV:'development'}),true)
})
