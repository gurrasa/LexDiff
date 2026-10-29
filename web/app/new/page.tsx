'use client'

import { useRouter } from 'next/navigation'
<<<<<<< HEAD
import { useEffect, useState } from 'react'
import { decodeEventLog, isAddress, isHex, type Address, type Hex } from 'viem'
import {
  connectWallet,
  DOMAIN,
  putEvidence,
  type Registration,
  REGISTRATION_TYPES,
  registryAbi,
  same,
  SEPOLIA_MOCK_FORWARDER,
  shortAddr,
  writeRegistry,
  ZERO_BYTES32,
} from '@/lib/registry'
=======
import { useState } from 'react'
import { decodeEventLog, isAddress, keccak256, toBytes, type Address, type Hex } from 'viem'
import { AGREEMENT_APPROVAL_TYPES, connectWallet, registry, registryAbi, REGISTRY_ADDRESS, writeRegistry } from '@/lib/registry'
>>>>>>> df31607 (Align LexDiff with evidence-first design)
import { type EscrowTerms, escrowTermsSchema } from '@/lib/terms'

const ZERO = '0x0000000000000000000000000000000000000000' as Address

export default function NewAgreement() {
  const router = useRouter()
  const [text, setText] = useState('')
  const [termsJson, setTermsJson] = useState('')
<<<<<<< HEAD
  const [roles, setRoles] = useState({ client: '', freelancer: '', reviewer: '', developer: '', target: '' })
  const [verifier, setVerifier] = useState({ forwarder: SEPOLIA_MOCK_FORWARDER as string, workflowOwner: '', workflowId: '' })
  const [supersedes, setSupersedes] = useState('')
  const [registration, setRegistration] = useState<Registration | null>(null)
  const [sigs, setSigs] = useState<{ client?: Hex; reviewer?: Hex }>({})
  const [demoV1, setDemoV1] = useState<string | null>(null)
=======
  const [roles, setRoles] = useState({ client: '', freelancer: '', reviewer: '', developer: '', target: '', verifier: '' })
  const [published, setPublished] = useState<{ hash: Hex; uri: string; title: string; deadline: bigint } | null>(null)
  const [approvals, setApprovals] = useState<{ client?: Hex; reviewer?: Hex }>({})
>>>>>>> df31607 (Align LexDiff with evidence-first design)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    fetch('/api/demo').then((r) => r.json()).then((d) => setDemoV1(d.escrowV1)).catch(() => {})
  }, [])

  const run = async (label: string, fn: () => Promise<void>) => {
    setBusy(label)
    setError('')
    try {
      await fn()
    } catch (e) {
      const err = e as { shortMessage?: string; message?: string }
      setError(err.shortMessage ?? err.message ?? String(e))
    } finally {
      setBusy('')
    }
  }

  // Anything edited after publishing invalidates the signatures collected so far.
  const resetSignatures = () => {
    setRegistration(null)
    setSigs({})
  }

<<<<<<< HEAD
  const extractFrom = async (agreement: string) => {
    const res = await fetch('/api/extract', { method: 'POST', body: JSON.stringify({ text: agreement }) })
    const body = await res.json()
    if (!res.ok) throw new Error(body.error)
    resetSignatures()
    setTermsJson(JSON.stringify(body.terms as EscrowTerms, null, 2))
  }

  const extract = () => run('Claude is reading the agreement (10–30 seconds)', () => extractFrom(text))

  const fillDemo = () =>
    run('Setting up the demo', async () => {
      const demo = await (await fetch('/demo/freelance-escrow.md')).text()
      setText(demo)
      const { account } = await connectWallet()
      setRoles({ client: account, freelancer: account, reviewer: account, developer: account, target: demoV1 ?? '' })
      setBusy('Claude is reading the agreement (10–30 seconds)')
      try {
        await extractFrom(demo)
      } catch {
        // No Claude key: fall back to the reviewed example terms.
        setTermsJson(await (await fetch('/demo/freelance-escrow.terms.json')).text())
      }
=======
  const updateRole = (key: keyof typeof roles, value: string) => {
    setRoles((current) => ({ ...current, [key]: value }))
    setPublished(null)
    setApprovals({})
  }

  const extract = () =>
    run('Extracting with Claude', async () => {
      const res = await fetch('/api/extract', { method: 'POST', body: JSON.stringify({ text }) })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error)
      const terms = body.terms as EscrowTerms
      setTermsJson(JSON.stringify(terms, null, 2))
      setRoles((r) => ({
        ...r,
        client: isAddress(terms.parties.client.wallet) ? terms.parties.client.wallet : r.client,
        freelancer: isAddress(terms.parties.freelancer.wallet) ? terms.parties.freelancer.wallet : r.freelancer,
      }))
>>>>>>> df31607 (Align LexDiff with evidence-first design)
    })

  const publish = () =>
    run('Saving the approved terms', async () => {
      for (const [k, v] of Object.entries(roles)) if (!isAddress(v)) throw new Error(`The ${k} needs a valid wallet address.`)
      if (!isAddress(verifier.forwarder)) throw new Error('The forwarder must be an address.')
      if (verifier.workflowOwner && !isAddress(verifier.workflowOwner)) throw new Error('The workflow owner must be an address.')
      if (verifier.workflowId && !(isHex(verifier.workflowId) && verifier.workflowId.length === 66)) {
        throw new Error('The workflow ID must be 32 bytes of hex.')
      }
      const draft = JSON.parse(termsJson)
      const terms = escrowTermsSchema.parse({
        ...draft,
        parties: {
          client: { ...draft.parties.client, wallet: roles.client },
          freelancer: { ...draft.parties.freelancer, wallet: roles.freelancer },
        },
      })
      const published = await putEvidence(terms)
      setSigs({})
      setRegistration({
        client: roles.client as Address,
        reviewer: roles.reviewer as Address,
        developer: roles.developer as Address,
        target: roles.target as Address,
        termsHash: published.hash,
        termsURI: published.uri,
        verifier: {
          forwarder: verifier.forwarder as Address,
          workflowOwner: (verifier.workflowOwner || ZERO) as Address,
          workflowId: (verifier.workflowId || ZERO_BYTES32) as Hex,
        },
        supersedes: BigInt(supersedes || 0),
        deadline: BigInt(Math.floor(Date.now() / 1000) + 24 * 3600),
      })
    })

  const sign = (role: 'client' | 'reviewer') =>
    run('Waiting for your signature', async () => {
      if (!registration) return
      const { wallet, account } = await connectWallet()
      if (!same(account, registration[role])) {
        throw new Error(`Switch MetaMask to the ${role}'s account (${shortAddr(registration[role])}).`)
      }
      const signature = await wallet.signTypedData({
        account,
        domain: DOMAIN(),
        types: REGISTRATION_TYPES,
        primaryType: 'Registration',
        message: registration,
      })
      // One person holding both roles signs once.
      setSigs((s) => (same(registration.client, registration.reviewer) ? { client: signature, reviewer: signature } : { ...s, [role]: signature }))
    })

<<<<<<< HEAD
  const register = () =>
    run('Registering on Sepolia', async () => {
      if (!registration || !sigs.client || !sigs.reviewer) return
      const receipt = await writeRegistry('registerAgreement', [registration, sigs.client, sigs.reviewer])
=======
  const publish = () =>
    run('Publishing reviewed terms', async () => {
      for (const [k, v] of Object.entries(roles)) if (!isAddress(v)) throw new Error(`${k} must be an address`)
      const terms = escrowTermsSchema.parse({
        ...JSON.parse(termsJson),
        parties: {
          client: { ...JSON.parse(termsJson).parties.client, wallet: roles.client },
          freelancer: { ...JSON.parse(termsJson).parties.freelancer, wallet: roles.freelancer },
        },
      })
      const res = await fetch('/api/terms', { method: 'POST', body: JSON.stringify(terms) })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error)
      setPublished({ hash: body.hash, uri: body.uri, title: terms.title, deadline: BigInt(Math.floor(Date.now() / 1000) + 3600) })
      setApprovals({})
    })

  const signApproval = (role: 'client' | 'reviewer') =>
    run(`Signing as ${role}`, async () => {
      if (!published) throw new Error('Publish the reviewed terms first')
      const expected = roles[role] as Address
      const { wallet, account } = await connectWallet()
      if (account.toLowerCase() !== expected.toLowerCase()) throw new Error(`Connect the ${role} wallet ${expected}`)
      const nonce = await registry.nonces(account)
      const signature = await wallet.signTypedData({
        account,
        domain: { name: 'LexDiff', version: '1', chainId: 11155111, verifyingContract: REGISTRY_ADDRESS },
        types: AGREEMENT_APPROVAL_TYPES,
        primaryType: 'AgreementApproval',
        message: {
          client: roles.client as Address,
          reviewer: roles.reviewer as Address,
          developer: roles.developer as Address,
          target: roles.target as Address,
          verifier: roles.verifier as Address,
          termsHash: published.hash,
          termsURIHash: keccak256(toBytes(published.uri)),
          titleHash: keccak256(toBytes(published.title)),
          nonce,
          deadline: published.deadline,
        },
      })
      setApprovals((current) => ({ ...current, [role]: signature }))
    })

  const register = () =>
    run('Registering approved agreement', async () => {
      if (!published || !approvals.client || !approvals.reviewer) throw new Error('Client and reviewer approvals are required')

      setBusy('Waiting for registerAgreement transaction')
      const receipt = await writeRegistry('registerAgreement', [
        roles.client as Address,
        roles.reviewer as Address,
        roles.developer as Address,
        roles.target as Address,
        roles.verifier as Address,
        published.hash as Hex,
        published.uri,
        published.title,
        published.deadline,
        approvals.client,
        approvals.reviewer,
      ])
>>>>>>> df31607 (Align LexDiff with evidence-first design)
      for (const log of receipt.logs) {
        try {
          const ev = decodeEventLog({ abi: registryAbi, data: log.data, topics: log.topics })
          if (ev.eventName === 'AgreementRegistered') {
            router.push(`/agreements/${(ev.args as { agreementId: bigint }).agreementId}`)
            return
          }
        } catch {}
      }
      router.push('/')
    })

  let preview: EscrowTerms | null = null
  try {
    preview = termsJson ? escrowTermsSchema.parse(JSON.parse(termsJson)) : null
  } catch {}

  const field = (value: string, onChange: (v: string) => void, placeholder = '0x…') => (
    <input
      className="mono"
      value={value}
      placeholder={placeholder}
      onChange={(e) => {
        onChange(e.target.value)
        resetSignatures()
      }}
    />
  )

  const signedBoth = !!sigs.client && !!sigs.reviewer
  const oneSigner = registration && same(registration.client, registration.reviewer)

  return (
    <>
      <div className="row spread" style={{ margin: '1rem 0' }}>
        <div>
          <h1>Check an agreement against its smart contract</h1>
          <p className="lede" style={{ margin: 0 }}>
            Four steps: paste the agreement, check what Claude understood, say who is involved, and sign.
          </p>
        </div>
        <button onClick={fillDemo} disabled={!!busy}>Fill in the demo for me</button>
      </div>
      {error && <p className="error">{error}</p>}
      {busy && <p className="notice">{busy}…</p>}

<<<<<<< HEAD
      <section className="panel stack">
        <h2 style={{ margin: 0 }}>1. The agreement</h2>
        <p className="small muted" style={{ margin: 0 }}>The signed legal agreement, in plain text. Claude will pick out the terms the smart contract must follow.</p>
        <textarea rows={10} value={text} onChange={(e) => setText(e.target.value)} placeholder="Paste the signed agreement…" />
        <div className="row">
          <button onClick={extract} disabled={!!busy || !text.trim()}>Read it with Claude</button>
          <button className="ghost" onClick={() => run('Loading', async () => setText(await (await fetch('/demo/freelance-escrow.md')).text()))} disabled={!!busy}>
            Use the demo agreement
          </button>
        </div>
      </section>

      <section className="panel stack" style={{ marginTop: '1rem' }}>
        <h2 style={{ margin: 0 }}>2. What Claude understood</h2>
        <p className="small muted" style={{ margin: 0 }}>
          AI can be wrong, so a lawyer checks this before anything is signed. Each term comes with the exact sentence it was taken from.
        </p>
        {!termsJson && <p className="muted">Nothing yet. Read an agreement in step 1.</p>}
        {preview && (
          <div className="grid two">
            <ul style={{ margin: 0 }}>
              <li>Amount: <b>{preview.payment.amount} {preview.payment.tokenSymbol}</b></li>
              <li>Delivery within: <b>{preview.deadlines.deliveryPeriodDays} days</b></li>
              <li>Client review period: <b>{preview.deadlines.reviewPeriodDays} days</b></li>
              <li>Refund if the deadline is missed: <b>{preview.refund.onMissedDeadline ? 'yes' : 'no'}</b></li>
              <li>Special powers anyone may have: <b>{preview.adminPowers.length ? preview.adminPowers.map((p) => p.category).join(', ') : 'none'}</b></li>
            </ul>
            <div className="small">
              <b>Where each term comes from</b>
              <ul style={{ margin: '0.25rem 0 0' }}>
                {preview.sourceClauses.map((c, i) => <li key={i}>“{c.quote}”</li>)}
              </ul>
=======
      <div className="grid two" style={{ marginTop: '1rem' }}>
        <section className="panel stack">
          <div className="row spread">
            <h3 style={{ margin: 0 }}>1 · Agreement text</h3>
            <button className="ghost small" onClick={loadDemo} disabled={!!busy}>Load demo agreement</button>
          </div>
          <textarea rows={22} value={text} onChange={(e) => setText(e.target.value)} placeholder="Paste the signed agreement…" />
          <button onClick={extract} disabled={!!busy || !text.trim()}>Extract terms with Claude</button>
        </section>

        <section className="panel stack">
          <h3 style={{ margin: 0 }}>2 · Review extracted terms</h3>
          {preview ? (
            <div className="small">
              <p>
                <b>{preview.payment.amount} {preview.payment.tokenSymbol}</b> · deliver within{' '}
                <b>{preview.deadlines.deliveryPeriodDays} days</b> · review <b>{preview.deadlines.reviewPeriodDays} days</b> ·
                refund on missed deadline <b>{preview.refund.onMissedDeadline ? 'yes' : 'no'}</b> · admin powers granted{' '}
                <b>{preview.adminPowers.length ? preview.adminPowers.map((p) => p.category).join(', ') : 'none'}</b>
              </p>
              <details>
                <summary>Source quotes ({preview.sourceClauses.length})</summary>
                <ul>
                  {preview.sourceClauses.map((c, i) => (
                    <li key={i}><code>{c.term}</code> — “{c.quote}”</li>
                  ))}
                </ul>
              </details>
            </div>
          ) : (
            termsJson && <p className="error small">Terms JSON does not match the schema.</p>
          )}
          <textarea rows={14} value={termsJson} onChange={(e) => { setTermsJson(e.target.value); setPublished(null); setApprovals({}) }} placeholder="Extracted terms appear here and can be edited." />
        </section>
      </div>

      <section className="panel stack" style={{ marginTop: '1rem' }}>
        <div className="row spread">
          <h3 style={{ margin: 0 }}>3 · Parties, roles and contract</h3>
          <button className="ghost small" onClick={fillMe} disabled={!!busy}>Use my wallet for empty roles (demo)</button>
        </div>
        <div className="grid four">
          {(
            [
              ['client', 'Client wallet (accepts risk)'],
              ['freelancer', 'Freelancer wallet'],
              ['reviewer', 'Reviewer / legal counsel'],
              ['developer', 'Developer (fixes)'],
              ['verifier', 'Chainlink CRE verifier / forwarder'],
            ] as const
          ).map(([k, label]) => (
            <div key={k}>
              <label>{label}</label>
              <input className="mono" value={roles[k]} onChange={(e) => updateRole(k, e.target.value)} placeholder="0x…" />
>>>>>>> df31607 (Align LexDiff with evidence-first design)
            </div>
          </div>
        )}
        {termsJson && !preview && <p className="error small">The terms below are not in the expected format.</p>}
        {termsJson && (
          <details>
            <summary>Correct the terms (JSON)</summary>
            <textarea rows={14} value={termsJson} onChange={(e) => { setTermsJson(e.target.value); resetSignatures() }} />
          </details>
        )}
      </section>

      <section className="panel stack" style={{ marginTop: '1rem' }}>
        <h2 style={{ margin: 0 }}>3. Who is involved</h2>
        <p className="small muted" style={{ margin: 0 }}>
          Wallet addresses for each role. For a one-person demo, use the same wallet everywhere.{' '}
          <button className="ghost small" onClick={() => run('Connecting wallet', async () => {
            const { account } = await connectWallet()
            resetSignatures()
            setRoles((r) => ({ client: r.client || account, freelancer: r.freelancer || account, reviewer: r.reviewer || account, developer: r.developer || account, target: r.target }))
          })} disabled={!!busy}>Use my wallet for empty roles</button>
        </p>
        <div className="grid two">
          <div><label>Client: pays, can accept risks</label>{field(roles.client, (v) => setRoles({ ...roles, client: v }))}</div>
          <div><label>Freelancer: gets paid</label>{field(roles.freelancer, (v) => setRoles({ ...roles, freelancer: v }))}</div>
          <div><label>Reviewer (lawyer): approves the terms</label>{field(roles.reviewer, (v) => setRoles({ ...roles, reviewer: v }))}</div>
          <div><label>Developer: wrote and fixes the contract</label>{field(roles.developer, (v) => setRoles({ ...roles, developer: v }))}</div>
        </div>
        <div>
<<<<<<< HEAD
          <label>The smart contract that will hold the money</label>
          {field(roles.target, (v) => setRoles({ ...roles, target: v }))}
          {demoV1 && !roles.target && (
            <button className="ghost small" style={{ marginTop: 6 }} onClick={() => { setRoles({ ...roles, target: demoV1 }); resetSignatures() }}>
              Use the demo escrow ({shortAddr(demoV1)})
            </button>
          )}
        </div>
        <details>
          <summary>Advanced: verifier and amendments</summary>
          <div className="grid two" style={{ marginTop: '0.5rem' }}>
            <div><label>Chainlink CRE forwarder</label>{field(verifier.forwarder, (v) => setVerifier({ ...verifier, forwarder: v }))}</div>
            <div><label>Workflow owner (optional)</label>{field(verifier.workflowOwner, (v) => setVerifier({ ...verifier, workflowOwner: v }))}</div>
            <div><label>Workflow ID (optional)</label>{field(verifier.workflowId, (v) => setVerifier({ ...verifier, workflowId: v }), '0x… 32 bytes')}</div>
            <div><label>This amends agreement # (optional)</label>{field(supersedes, setSupersedes, 'e.g. 1')}</div>
          </div>
          <p className="small muted">
            The verifier decides who may mark issues as fixed. The default is the Chainlink simulation forwarder used in this demo.
            It is locked in when you sign.
          </p>
        </details>
      </section>

      <section className="panel stack" style={{ marginTop: '1rem' }}>
        <h2 style={{ margin: 0 }}>4. Sign and register</h2>
        <p className="small muted" style={{ margin: 0 }}>
          The lawyer and the client both sign. That records who approved Claude&apos;s reading of the agreement. Only fingerprints (hashes) go on the blockchain; the terms themselves stay private.
=======
          <label>Deployed contract (Sepolia, verified on Etherscan)</label>
          <input className="mono" value={roles.target} onChange={(e) => updateRole('target', e.target.value)} placeholder="0x…" />
        </div>
        {!published ? (
          <button onClick={publish} disabled={!!busy || !preview}>Publish reviewed terms</button>
        ) : (
          <div className="stack">
            <p className="small muted">Reviewed terms hash: <code>{published.hash}</code></p>
            <div className="row">
              <button onClick={() => signApproval('client')} disabled={!!busy || !!approvals.client}>
                {approvals.client ? 'Client approved ✓' : 'Client: approve reviewed terms'}
              </button>
              <button onClick={() => signApproval('reviewer')} disabled={!!busy || !!approvals.reviewer}>
                {approvals.reviewer ? 'Reviewer approved ✓' : 'Reviewer: approve reviewed terms'}
              </button>
            </div>
            <button onClick={register} disabled={!!busy || !approvals.client || !approvals.reviewer}>Register approved agreement on-chain</button>
          </div>
        )}
        <p className="small muted">
          Registering emits <code>CheckRequested</code>, which the CRE workflow&apos;s log trigger picks up.
>>>>>>> df31607 (Align LexDiff with evidence-first design)
        </p>
        <div className="row">
          <button onClick={publish} disabled={!!busy || !preview}>{registration ? '✓ Terms saved' : 'a. Save the approved terms'}</button>
          {oneSigner ? (
            <button onClick={() => sign('reviewer')} disabled={!!busy || !registration || signedBoth}>{signedBoth ? '✓ Signed' : 'b. Sign (as lawyer and client)'}</button>
          ) : (
            <>
              <button onClick={() => sign('reviewer')} disabled={!!busy || !registration || !!sigs.reviewer}>{sigs.reviewer ? '✓ Lawyer signed' : 'b. Lawyer signs'}</button>
              <button onClick={() => sign('client')} disabled={!!busy || !registration || !!sigs.client}>{sigs.client ? '✓ Client signed' : 'c. Client signs'}</button>
            </>
          )}
          <button onClick={register} disabled={!!busy || !signedBoth}>Register on the blockchain</button>
        </div>
      </section>
    </>
  )
}
