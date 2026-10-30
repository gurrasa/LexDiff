import { test } from 'node:test'
import assert from 'node:assert/strict'
import { evaluateConsent, type ActorRole, type Consent } from '../../lib/legal/consent'
const roles = ['client','freelancer','reviewer','developer'] as ActorRole[]
const expected = Object.fromEntries(roles.map((r,i)=>[r,'0x'+(i+1).toString(16).padStart(40,'0')])) as Record<ActorRole,string>
const h = '0x'+'a'.repeat(64)
const signatures: Consent[] = roles.map(role=>({role,wallet:expected[role],statementHash:h,signedAt:new Date(0).toISOString(),capacity:'self'}))
test('material amendment requires independently recorded freelancer assent',()=>{
 assert.equal(evaluateConsent('material-amendment',h,expected,signatures).permitted,true)
 assert.match(evaluateConsent('material-amendment',h,expected,signatures.filter(s=>s.role!=='freelancer')).blockers.join(','),/freelancer/)
})
test('unknown organizational authority blocks readiness',()=>{
 const amended=signatures.map(s=>s.role==='client'?{...s,capacity:'organization' as const}:s)
 assert.match(evaluateConsent('replacement',h,expected,amended).blockers.join(','),/authority/)
})
