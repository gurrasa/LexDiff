import assert from 'node:assert/strict'
import { test } from 'node:test'
import { makeSession, SESSION_COOKIE } from '../../lib/server/wallet-session'
import { GET as list, POST as create } from '../../app/api/registrations/route'
import { GET as detail, POST as edit } from '../../app/api/registrations/[id]/route'
import { POST as relay } from '../../app/api/relay/route'
import { POST as simulate } from '../../app/api/run-check/route'

const alice = '0x1111111111111111111111111111111111111111'
const bob = '0x' + '2'.repeat(40)
process.env.LEXDIFF_SESSION_SECRET = 'c'.repeat(64)
const signed = (url: string, method = 'GET', body?: string, origin = 'http://localhost:3000') => new Request(url, {
  method,
  headers: { cookie: `${SESSION_COOKIE}=${makeSession(alice)}`, origin },
  ...(body !== undefined ? { body } : {}),
})
const id = '0x' + 'a'.repeat(64)
const context = { params: Promise.resolve({ id }) } as never

test('anonymous registration listing blocked', async () => {
  assert.equal((await list(new Request('http://localhost:3000/api/registrations?address=' + alice))).status, 401)
})
test('cannot list someone else pending registrations', async () => {
  assert.equal((await list(signed('http://localhost:3000/api/registrations?address=' + bob))).status, 403)
})
test('anonymous registration lookup blocked before touching storage', async () => {
  assert.equal((await detail(new Request('http://localhost:3000/api/registrations/' + id), context)).status, 401)
})
test('anonymous registration creation blocked', async () => {
  assert.equal((await create(new Request('http://localhost:3000/api/registrations', { method: 'POST', body: '{}' }))).status, 401)
})
test('oversized registration creation body rejected without Content-Length', async () => {
  const req = signed('http://localhost:3000/api/registrations', 'POST', ' '.repeat(16_001))
  assert.equal((await create(req)).status, 413)
})
test('cross-origin registration mutation blocked', async () => {
  const req = signed('http://localhost:3000/api/registrations', 'POST', '{}', 'https://attacker.example')
  assert.equal((await create(req)).status, 401)
})
test('anonymous registration modification blocked', async () => {
  assert.equal((await edit(new Request('http://localhost:3000/api/registrations/' + id, { method: 'POST', body: '{}' }), context)).status, 401)
})
test('anonymous relayer use blocked before key selection', async () => {
  assert.equal((await relay(new Request('http://localhost:3000/api/relay', { method: 'POST', body: '{}' }))).status, 401)
})
test('production CRE simulation disabled even with feature flag', async () => {
  const prevNode = process.env.NODE_ENV
  const prevCre = process.env.ENABLE_LOCAL_CRE
  try {
    // Node's test runner permits modifying process.env at runtime.
    Object.assign(process.env, { NODE_ENV: 'production', ENABLE_LOCAL_CRE: 'true' })
    assert.equal((await simulate(new Request('http://localhost:3000/api/run-check', { method: 'POST', body: '{}' }))).status, 403)
  } finally {
    if (prevNode === undefined) Reflect.deleteProperty(process.env, 'NODE_ENV'); else Reflect.set(process.env, 'NODE_ENV', prevNode)
    if (prevCre === undefined) delete process.env.ENABLE_LOCAL_CRE; else process.env.ENABLE_LOCAL_CRE = prevCre
  }
})
