import { test } from 'node:test'
import assert from 'node:assert/strict'
import { redactFields } from '../../lib/legal/export-policy'
const items = [{id:'x',classification:'privileged' as const,content:'PRIVATE LEGAL ADVICE'},{id:'y',classification:'public-technical' as const,content:'Method'}]
test('unauthorized export includes no original bytes',()=>{
 const x=redactFields(items,{authenticated:false,agreementScoped:true,authorizedRole:true,approvedDisclosure:true,audience:'parties'})
 assert.equal(x.included.length,0)
})
test('party export strips privileged content from actual data',()=>{
 const x=redactFields(items,{authenticated:true,agreementScoped:true,authorizedRole:true,approvedDisclosure:true,audience:'parties'})
 assert.equal(JSON.stringify(x.included).includes('PRIVATE LEGAL ADVICE'),false)
 assert.equal(x.exclusions.length,1)
})
