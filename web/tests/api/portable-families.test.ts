import test from 'node:test';import assert from 'node:assert/strict';import {keccak256,toBytes} from 'viem'
import {buildPortableEvidence} from '../../lib/legal/portable-evidence'
import {validateFamily,freelanceEscrowFamily} from '../../lib/verification/contract-families'
test('escrow checker explicitly discloses exclusions',()=>{assert.deepEqual(validateFamily(freelanceEscrowFamily),[]);assert.ok(freelanceEscrowFamily.excludedRequirements.includes('behavioral-refund-proof'))})
test('portable derivative never includes unauthorized content',()=>{const es=[{id:'public',content:'ok',classification:'public-technical' as const,hash:keccak256(toBytes('ok'))},{id:'secret',content:'PRIVATE',classification:'privileged' as const,hash:keccak256(toBytes('PRIVATE'))}];const p=buildPortableEvidence(es,['public'],'2026-10-30T00:00:00Z');assert.equal(JSON.stringify(p).includes('PRIVATE'),false);assert.deepEqual(p.excluded,['secret'])})
test('tamper results in warning',()=>{const p=buildPortableEvidence([{id:'e',content:'new',classification:'shared-contract',hash:keccak256(toBytes('old'))}],['e'],'2026-10-30T00:00:00Z');assert.match(p.warnings.join(' '),/mismatch/)})
