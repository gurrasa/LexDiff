import assert from 'node:assert/strict'
import { test } from 'node:test'
import { keccak256, toBytes } from 'viem'
import { canonicalize } from '../../lib/terms'
import { renderLegalCaseRecord, verifyCaseSnapshot } from '../../lib/case-record'
const hash = (x: unknown) => keccak256(toBytes(canonicalize(x)))
const text = { schema: 'lexdiff/agreement-document@1', text: 'Confidential <script>alert(1)</script> agreement' }
const terms = { schema: 'lexdiff/escrow-terms@1', sourceClauses: [{ term: 'Payment', quote: 'Pay the client & freelancer' }] }
const record = () => ({
  schema: 'lexdiff/case-record@3', agreementId: '1', exportedAt: '2026-10-29T00:00:00Z', chainId: 11155111,
  registry: '0x1111111111111111111111111111111111111111',
  agreement: { client: '0x1', freelancer: '0x2', reviewer: '0x3', developer: '0x4', target: '0x5', agreementHash: hash(text), termsHash: hash(terms) },
  documents: { [hash(text)]: text, [hash(terms)]: terms },
  checks: [], findings: [{ key: hash('finding'), verification: 2, remediation: 0, disposition: 0, evidenceHash: hash('evidence') }],
  decisions: {}, events: [], contractHistory: [],
})
test('source fingerprint is deterministic and complete A-I sections are present', () => {
  const r = record(); assert.equal(verifyCaseSnapshot(r).sourceHash, verifyCaseSnapshot(r).sourceHash)
  const html = renderLegalCaseRecord(r)
  for (const letter of 'ABCDEFGHI') assert.match(html, new RegExp(`${letter}\\.`))
  assert.match(html, /Not a determination of breach/)
})
test('untrusted legal text is HTML escaped, not executable', () => {
  const html = renderLegalCaseRecord(record())
  assert.doesNotMatch(html, /<script>/)
  assert.match(html, /&lt;script&gt;/)
  assert.match(html, /&amp;/)
})
test('missing and tampered source evidence produce explicit warnings', () => {
  const r = record(); delete (r.documents as Record<string, unknown>)[hash(text)]
  assert.ok(verifyCaseSnapshot(r).warnings.some(w => w.includes('Missing original')))
  ;(r.documents as Record<string, unknown>)[hash(text)] = { ...text, text: 'changed' }
  assert.ok(verifyCaseSnapshot(r).warnings.some(w => w.includes('Tampered')))
})
test('all adverse findings are reported without selective filtering', () => {
  const r = record(); const result = verifyCaseSnapshot(r)
  assert.equal(result.findingsCount, 1)
  assert.equal(result.unresolvedCount, 1)
  assert.match(renderLegalCaseRecord(r), /Complete technical findings register/)
})
