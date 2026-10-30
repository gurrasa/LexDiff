import {test} from 'node:test'
import assert from 'node:assert/strict'
import {assessOffchainErasure} from '../../lib/legal/privacy-policy'
test('legal hold blocks automatic erasure',()=>assert.equal(assessOffchainErasure('legal-advice',true,false).canDelete,false))
test('onchain records cannot be deleted by an offchain request',()=>assert.equal(assessOffchainErasure('public-chain',false,false).canDelete,false))
