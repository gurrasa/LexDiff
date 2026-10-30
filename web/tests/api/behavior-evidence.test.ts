import test from 'node:test';import assert from 'node:assert/strict'
import {evaluateBehavior,type RuntimeProvenance} from '../../lib/verification/behavior-evidence'
const p:RuntimeProvenance={chainId:11155111,target:'0x'+'1'.repeat(40),blockNumber:'100',runtimeCodeHash:'0x'+'2'.repeat(64),checkerVersion:'test-v1'}
test('cannot pass without executed scenarios',()=>assert.equal(evaluateBehavior([],p,['refund-at-deadline']).result,'NotChecked'))
test('structural/no transaction evidence is inconclusive',()=>assert.equal(evaluateBehavior([{id:'a',kind:'positive',caller:'client',token:'USDC',recipient:'client',amountMinor:'100',timeBoundary:'after',execution:'not-run',expected:'success'}],p,['a']).result,'Inconclusive'))
test('actual mismatch is Fail, never silently Pass',()=>assert.equal(evaluateBehavior([{id:'a',kind:'negative',caller:'attacker',token:'USDC',recipient:'attacker',amountMinor:'100',timeBoundary:'early',execution:'observed-success',expected:'revert',txHash:'0x'+'3'.repeat(64)}],p,['a']).result,'Fail'))
