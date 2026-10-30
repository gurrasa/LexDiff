import { test } from 'node:test'
import assert from 'node:assert/strict'
import { productionGate, allowedCREAgreement } from '../../lib/server/production-gates'
test('production fails closed without keys, directories and allowlist', () => {
  const result = productionGate({ NODE_ENV:'production' })
  assert.equal(result.ok,false); assert.ok(result.blockers.length >= 4)
})
test('CRE report scope permits only explicit production agreement IDs', () => {
  const env = {NODE_ENV:'production',LEXDIFF_CRE_ALLOWED_AGREEMENT_IDS:'1,3'}
  assert.equal(allowedCREAgreement('1',env),true)
  assert.equal(allowedCREAgreement('2',env),false)
  assert.equal(allowedCREAgreement('01',env),false)
  assert.equal(allowedCREAgreement('1',{NODE_ENV:'production'}),false)
})
