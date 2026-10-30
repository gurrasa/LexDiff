import assert from 'node:assert/strict'
import {test} from 'node:test'
import {mkdtemp,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {admitReportOnce,validReportAdmission} from '../../lib/server/report-replay'
const payload=()=>({agreementId:'1',workflowId:'0x'+'a'.repeat(64),signer:'0x'+'b'.repeat(40),reportHash:'0x'+'c'.repeat(64),sequence:1,expiresAt:Date.now()+60_000})
test('replay key is admitted once even under parallel requests',async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'ldx-replay-'))
 try{const outcomes=await Promise.all(Array.from({length:12},()=>admitReportOnce(payload(),root)));assert.equal(outcomes.filter(Boolean).length,1)}finally{await rm(root,{recursive:true,force:true})}
})
test('expired or malformed workflow admissions are denied',()=>{
 assert.equal(validReportAdmission({...payload(),expiresAt:Date.now()-1}),false)
 assert.equal(validReportAdmission({...payload(),workflowId:'spoofed'}),false)
})
