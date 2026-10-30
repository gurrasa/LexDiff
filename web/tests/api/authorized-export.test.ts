import assert from 'node:assert/strict';import {test} from 'node:test'
import {authorizedExport} from '../../lib/legal/authorized-export'
const a='0x'+'a'.repeat(40);const b='0x'+'b'.repeat(40)
const r={agreementId:'42',requester:a,recipient:a,role:'client' as const,grants:{client:[a]}}
const records=[{hash:'0x'+'1'.repeat(64),agreementId:'42',audiences:['client' as const],content:'public'},{hash:'0x'+'2'.repeat(64),agreementId:'42',audiences:['reviewer' as const],content:'PRIVILEGED',privileged:true}]
test('export includes only authorized recipients and no privileged bytes',()=>{
 const out=authorizedExport(r,records);assert.equal(out.ok,true)
 if(out.ok){assert.equal(out.records.length,1);assert.equal(JSON.stringify(out).includes('PRIVILEGED'),false);assert.equal(out.manifest.exclusions.length,1)}
})
test('recipient substitution and agreement mixing fail closed',()=>{
 assert.equal(authorizedExport({...r,recipient:b},records).ok,false)
 assert.equal(authorizedExport(r,[...records,{...records[0],agreementId:'43'}]).ok,false)
 assert.equal(authorizedExport({...r,grants:{client:[]}},records).ok,false)
})
