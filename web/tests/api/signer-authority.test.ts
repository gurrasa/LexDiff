import assert from 'node:assert/strict';import {test} from 'node:test'
import {authorityIssues,independentSigners} from '../../lib/legal/signer-authority'
const good={agreementId:'1',wallet:'0x'+'a'.repeat(40),legalName:'Example Ltd',capacity:'director' as const,entityId:'Org-1',authorityEvidenceHash:'0x'+'f'.repeat(64),validFrom:'2025-01-01T00:00:00Z',verifiedBy:'reviewer',verifiedAt:'2025-02-01T00:00:00Z'}
test('authority without independent review or evidence cannot be accepted',()=>{
 assert.deepEqual(authorityIssues(good,'2026-01-01T00:00:00Z'),[])
 assert.ok(authorityIssues({...good,authorityEvidenceHash:undefined,verifiedBy:undefined},'2026-01-01T00:00:00Z').length>0)
 assert.ok(authorityIssues({...good,validUntil:'2025-12-31T00:00:00Z'},'2026-01-01T00:00:00Z').length>0)
})
test('one person cannot fill two supposedly independent signing roles',()=>{assert.equal(independentSigners([good,{...good}]),false)})
