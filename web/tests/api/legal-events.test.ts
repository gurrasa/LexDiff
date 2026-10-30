import test from 'node:test';import assert from 'node:assert/strict'
import {deriveLegalTimeline,legalEffect,type LegalEvent} from '../../lib/legal/event-ledger'
const h='0x'+'a'.repeat(64);const a='0x'+'b'.repeat(40)
const base:LegalEvent={id:'e1',agreementId:'case-1',kind:'Receipt',actor:a,role:'developer',statementHash:h,occurredAt:'2026-10-30T00:00:00Z',evidenceHashes:[h],references:[]}
test('receipt does not imply settlement or waiver',()=>assert.match(legalEffect('Receipt'),/Receipt only/))
test('notice response requires chronological references',()=>{const x=deriveLegalTimeline([base,{...base,id:'e2',kind:'Response',references:[]}]);assert.match(x.issues.join(' '),/preceding event/)})
test('rejects invalid references and duplicate event IDs',()=>{const x=deriveLegalTimeline([base,{...base,id:'e1',references:['missing']}]);assert.match(x.issues.join(' '),/Duplicate event ID/);assert.match(x.issues.join(' '),/missing referenced/)})
