import test from 'node:test';import assert from 'node:assert/strict'
import {freezeCaseSnapshot} from '../../lib/legal/case-assertions'
const src={id:'e1',hash:'0x'+'a'.repeat(64),available:true,verified:true,classification:'shared-contract' as const}
const a={id:'a1',classification:'technical_observation' as const,narrative:'Function observed',evidenceIds:['e1'],verification:'verified' as const,limitations:[]}
test('snapshot hash deterministic',()=>{const x={caseId:'x',cutoff:'2026-10-30T00:00:00Z',sources:[src],assertions:[a]};assert.equal(freezeCaseSnapshot(x).sourceHash,freezeCaseSnapshot(x).sourceHash)})
test('missing evidence cannot support verified assertions silently',()=>{const x=freezeCaseSnapshot({caseId:'x',cutoff:'2026-10-30T00:00:00Z',sources:[{...src,available:false}],assertions:[a]});assert.equal(x.complete,false);assert.match(x.warnings.join(' '),/unavailable/)})
test('legal judgment cannot be machine verified',()=>{const x=freezeCaseSnapshot({caseId:'x',cutoff:'2026-10-30T00:00:00Z',sources:[src],assertions:[{...a,classification:'legal_question'}]});assert.match(x.warnings.join(' '),/Legal conclusion/)})
