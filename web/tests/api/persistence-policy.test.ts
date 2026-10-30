import {test} from 'node:test';import assert from 'node:assert/strict'
import {productionPersistenceReady} from '../../lib/server/persistence-policy'
test('production persistence refuses local plaintext and unverified TLS',()=>{
 assert.equal(productionPersistenceReady({}),false)
 assert.equal(productionPersistenceReady({postgresUrl:'postgres://local/db',evidenceEncryptionKeyId:'examplekey',auditRole:'auditor'}),false)
 assert.equal(productionPersistenceReady({postgresUrl:'postgresql://host/db?sslmode=verify-full',evidenceEncryptionKeyId:'examplekey',auditRole:'auditor'}),true)
})
