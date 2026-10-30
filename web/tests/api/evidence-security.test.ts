import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { readFile, rm, writeFile } from 'node:fs/promises'
import { after, before, test } from 'node:test'
import os from 'node:os'
import path from 'node:path'
import { keccak256, toBytes } from 'viem'
import { canonicalize } from '../../lib/terms'

// Test credentials only. Never import real local .env secrets.
const root = mkdtempSync(path.join(os.tmpdir(), 'lexdiff-evidence-security-'))
process.env.EVIDENCE_DIR = path.join(root, 'evidence')
process.env.EVIDENCE_METADATA_DIR = path.join(root, 'metadata')
process.env.LEXDIFF_EVIDENCE_API_TOKEN = 'a'.repeat(64)
process.env.LEXDIFF_SESSION_SECRET = 'b'.repeat(64)

let POST: typeof import('../../app/api/evidence/route').POST
let GET: typeof import('../../app/api/evidence/[hash]/route').GET
let makeSession: typeof import('../../lib/server/wallet-session').makeSession
const serviceToken = 'a'.repeat(64)
const walletAddress = '0x1111111111111111111111111111111111111111'
const origin = 'http://localhost:3000'
const report = { schema: 'lexdiff/report@3', agreementId: '1', target: walletAddress, codeHash: '0x' + 'a'.repeat(64), termsHash: '0x' + 'b'.repeat(64), contractName: 'TestEscrow', onchain: {}, findings: [] }
const document = { schema: 'lexdiff/agreement-document@1', text: 'Confidential test contract' }
const canonical = canonicalize(document)
const docHash = keccak256(toBytes(canonical))

before(async () => {
  // These modules read evidence directory variables at import time.
  ;({ POST } = await import('../../app/api/evidence/route'))
  ;({ GET } = await import('../../app/api/evidence/[hash]/route'))
  ;({ makeSession } = await import('../../lib/server/wallet-session'))
})

after(async () => { await rm(root, { recursive: true, force: true }) })

function upload(value: unknown, options: { service?: string; wallet?: boolean; origin?: string } = {}) {
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  if (options.service !== undefined) headers.authorization = `Bearer ${options.service}`
  if (options.wallet) headers.cookie = `lexdiff_session=${makeSession(walletAddress)}`
  if (options.origin) headers.origin = options.origin
  return POST(new Request(`${origin}/api/evidence`, {
    method: 'POST', headers, body: JSON.stringify(value),
  }))
}

function retrieve(hash: string, options: { service?: string; wallet?: boolean } = {}) {
  const headers: Record<string, string> = {}
  if (options.service !== undefined) headers.authorization = `Bearer ${options.service}`
  if (options.wallet) headers.cookie = `lexdiff_session=${makeSession(walletAddress)}`
  const request = new Request(`${origin}/api/evidence/${hash}`, { headers })
  const ctx = { params: Promise.resolve({ hash }) } as Parameters<typeof GET>[1]
  return GET(request, ctx)
}

test('missing CRE token denies report uploads', async () => {
  assert.equal((await upload(report)).status, 401)
})

test('incorrect CRE token denies report uploads', async () => {
  assert.equal((await upload(report, { service: 'wrong' })).status, 401)
})

test('valid CRE token accepts a report', async () => {
  assert.equal((await upload(report, { service: serviceToken })).status, 200)
})

test('anonymous browser cannot upload a legal document', async () => {
  assert.equal((await upload(document)).status, 401)
})

test('browser with valid wallet session must supply matching origin', async () => {
  assert.equal((await upload(document, { wallet: true, origin: 'https://evil.example' })).status, 401)
})

test('authenticated wallet can upload evidence, but a hash alone cannot retrieve it', async () => {
  const res = await upload(document, { wallet: true, origin })
  assert.equal(res.status, 200)
  assert.equal((await res.json() as { hash: string }).hash, docHash)
  assert.equal((await retrieve(docHash)).status, 404)
  assert.equal((await retrieve(docHash, { wallet: true })).status, 200)
})

test('CRE token does not grant access to a private legal document', async () => {
  assert.equal((await retrieve(docHash, { service: serviceToken })).status, 404)
})

test('CRE token does not grant access to reports', async () => {
  const hash = keccak256(toBytes(canonicalize(report)))
  assert.equal((await retrieve(hash, { service: serviceToken })).status, 404)
})

test('tampering a stored document is detected', async () => {
  const evidenceFile = path.join(process.env.EVIDENCE_DIR!, `${docHash}.json`)
  const original = await readFile(evidenceFile, 'utf8')
  try {
    await writeFile(evidenceFile, JSON.stringify({ ...document, text: 'Modified' }))
    assert.equal((await retrieve(docHash, { wallet: true })).status, 409)
  } finally {
    await writeFile(evidenceFile, original)
  }
})

test('oversized evidence body is rejected without a content-length header', async () => {
  const oversized = { ...document, text: 'x'.repeat(300_000) }
  assert.equal((await upload(oversized, { wallet: true, origin })).status, 413)
})

test('unsupported document types are rejected', async () => {
  assert.equal((await upload({ schema: 'unknown@1' }, { wallet: true, origin })).status, 400)
})

test('CRE token cannot upload an unbound report envelope', async () => {
  assert.equal((await upload({ schema: 'lexdiff/report@3', findings: [] }, { service: serviceToken })).status, 400)
})
