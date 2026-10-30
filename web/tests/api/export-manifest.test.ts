import {test} from 'node:test'
import {strict as assert} from 'node:assert'
import {buildExportManifest} from '../../lib/legal/export-manifest'
test('redaction excludes privileged source bytes and makes a reproducible manifest',()=>{
 const items=[{id:'1',classification:'public-technical' as const,content:'public',evidenceHash:'0x'+'a'.repeat(64)},{id:'2',classification:'privileged' as const,content:'PRIVILEGED SECRET',evidenceHash:'0x'+'b'.repeat(64)}]
 const p={authenticated:true,agreementScoped:true,authorizedRole:true,approvedDisclosure:true,audience:'parties' as const}
 const a=buildExportManifest(items,p,'2026-10-30T00:00:00.000Z','0x'+'c'.repeat(64))
 const b=buildExportManifest(items,p,'2026-10-30T00:00:00.000Z','0x'+'c'.repeat(64))
 assert.equal(JSON.stringify(a).includes('PRIVILEGED SECRET'),false)
 assert.deepEqual(a,b);assert.deepEqual(a.manifest.excludedEvidenceIds,['2'])
})
