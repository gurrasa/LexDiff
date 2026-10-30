import {test} from 'node:test'
import {strict as assert} from 'node:assert'
import {reportSafetyIssues} from '../../lib/verification/report-safety'
test('structural methods cannot certify a Pass result',()=>{
 assert.equal(reportSafetyIssues({findings:[{result:1,method:'source-structure'}]}).length,1)
 assert.equal(reportSafetyIssues({findings:[{result:3,method:'source-structure'}]}).length,0)
})
