import { test } from 'node:test'
import { strict as assert } from 'node:assert'
import { evidenceAuditLine } from '../../lib/server/evidence-audit'
test('audit line avoids raw actor and has a validated hash', () => {
 const line=evidenceAuditLine({action:'read',evidenceHash:'0x'+'a'.repeat(64),kind:'terms',outcome:'denied',actor:'0xPRIVATE'},'2026-01-01T00:00:00.000Z')
 assert.equal(JSON.parse(line).outcome,'denied');assert.equal(line.includes('0xPRIVATE'),false)
 assert.throws(()=>evidenceAuditLine({action:'read',evidenceHash:'bad',kind:'terms',outcome:'allowed',actor:'x'}))
})
