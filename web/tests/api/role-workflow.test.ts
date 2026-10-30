import test from 'node:test';import assert from 'node:assert/strict'
import {visibleTasks,validateResolverBundle} from '../../lib/legal/role-workflow'
test('role queues never include other roles or agreements',()=>{const t=[{id:'a',agreementId:'x',kind:'review-clauses' as const,assignedRole:'reviewer' as const,state:'pending' as const,sourceIds:[]},{id:'b',agreementId:'y',kind:'review-clauses' as const,assignedRole:'reviewer' as const,state:'pending' as const,sourceIds:[]}];assert.deepEqual(visibleTasks(t,'reviewer','x').map(x=>x.id),['a'])})
test('resolver disclosure fails closed without authorization',()=>assert.equal(validateResolverBundle([],false).releasable,false))
