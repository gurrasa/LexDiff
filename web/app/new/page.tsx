'use client'

import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { isAddress, isHex, type Address, type Hex } from 'viem'
import {
  connectWallet,
  putEvidence,
  type Registration,
  registrationToJson,
  SEPOLIA_MOCK_FORWARDER,
  shortAddr,
  ZERO_BYTES32,
} from '@/lib/registry'
import { type EscrowTerms, escrowTermsSchema } from '@/lib/terms'

const ZERO = '0x0000000000000000000000000000000000000000' as Address

export default function NewAgreement() {
  const router = useRouter()
  const [text, setText] = useState('')
  const [termsJson, setTermsJson] = useState('')
  const [roles, setRoles] = useState({ client: '', freelancer: '', reviewer: '', developer: '', target: '' })
  const [verifier, setVerifier] = useState({ forwarder: SEPOLIA_MOCK_FORWARDER as string, workflowOwner: '', workflowId: '' })
  const [supersedes, setSupersedes] = useState('')
  const [demoV1, setDemoV1] = useState<string | null>(null)
  const [demoWebsite, setDemoWebsite] = useState<string | null>(null)
  const [demoParties, setDemoParties] = useState<{ client?: string; freelancer?: string; developer?: string }>({})
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    fetch('/api/demo')
      .then((r) => r.json())
      .then((d) => {
        setDemoV1(d.escrowV1)
        setDemoWebsite(d.websiteEscrow)
        setDemoParties({ client: d.client ?? undefined, freelancer: d.freelancer ?? undefined, developer: d.developer ?? undefined })
      })
      .catch(() => {})
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

  // Signatures are collected on /sign/[id] after saving, so editing here never invalidates them.
  const resetSignatures = () => {}

  const extractFrom = async (agreement: string) => {
    const res = await fetch('/api/extract', { method: 'POST', body: JSON.stringify({ text: agreement }) })
    const body = await res.json()
    if (!res.ok) throw new Error(body.error)
    resetSignatures()
    setTermsJson(JSON.stringify(body.terms as EscrowTerms, null, 2))
  }

  const extract = () => run('Claude is reading the agreement (10–30 seconds)', () => extractFrom(text))

  /** `name` is a file stem in public/demo: <name>.md (agreement) and <name>.terms.json (reviewed fallback). */
  const fillDemo = (name: string, target: string | null) =>
    run('Setting up the demo', async () => {
      const demo = await (await fetch(`/demo/${name}.md`)).text()
      setText(demo)
      // You fill this in as the lawyer. Client, freelancer and developer are the parties the demo escrow was
      // deployed with, so each of them can act from their own wallet.
      const { account } = await connectWallet()
      setRoles({
        client: demoParties.client ?? account,
        freelancer: demoParties.freelancer ?? account,
        reviewer: account,
        developer: demoParties.developer ?? account,
        target: target ?? '',
      })
      setBusy('Claude is reading the agreement (10–30 seconds)')
      try {
        await extractFrom(demo)
      } catch {
        // No Claude key: fall back to the reviewed example terms.
        setTermsJson(await (await fetch(`/demo/${name}.terms.json`)).text())
      }
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
      if (!text.trim()) throw new Error('Paste the full signed agreement in step 1: its fingerprint is signed together with the terms.')
      // The full document and the structured terms are both bound: the terms alone are not the agreement.
      const document = await putEvidence({ schema: 'lexdiff/agreement-document@1', text })
      const published = await putEvidence(terms)
      const registration: Registration = {
        client: roles.client as Address,
        reviewer: roles.reviewer as Address,
        developer: roles.developer as Address,
        freelancer: roles.freelancer as Address,
        target: roles.target as Address,
        agreementHash: document.hash,
        termsHash: published.hash,
        termsURI: published.uri,
        verifier: {
          forwarder: verifier.forwarder as Address,
          workflowOwner: (verifier.workflowOwner || ZERO) as Address,
          workflowId: (verifier.workflowId || ZERO_BYTES32) as Hex,
        },
        supersedes: BigInt(supersedes || 0),
        // A week for everyone to sign; the request expires after that.
        deadline: BigInt(Math.floor(Date.now() / 1000) + 7 * 24 * 3600),
      }
      setBusy('Creating the signing link')
      const res = await fetch('/api/registrations', { method: 'POST', body: JSON.stringify({ registration: registrationToJson(registration) }) })
      const pending = await res.json()
      if (!res.ok) throw new Error(pending.error)
      router.push(`/sign/${pending.id}`)
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


  return (
    <>
      <div className="row spread" style={{ margin: '1rem 0' }}>
        <div>
          <h1>Check an agreement against its smart contract</h1>
          <p className="lede" style={{ margin: 0 }}>
            Four steps: paste the agreement, check what Claude understood, say who is involved, and sign.
          </p>
        </div>
        <div className="stack" style={{ textAlign: 'right' }}>
          <button onClick={() => fillDemo('freelance-escrow', demoV1)} disabled={!!busy}>Fill in the demo for me</button>
          <button className="ghost small" onClick={() => fillDemo('website-redesign', demoWebsite)} disabled={!!busy}>
            Second demo: website redesign
          </button>
        </div>
      </div>
      {error && <p className="error">{error}</p>}
      {busy && <p className="notice">{busy}…</p>}

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
        <h2 style={{ margin: 0 }}>4. Save and send for signatures</h2>
        <p className="small muted" style={{ margin: 0 }}>
          Saving creates a signing page. The lawyer and the client each open it and sign with their own wallet. That records
          who approved Claude&apos;s reading of the agreement. Only fingerprints (hashes) go on the blockchain; the terms stay private.
        </p>
        <div className="row">
          <button onClick={publish} disabled={!!busy || !preview}>Save the approved terms and create the signing link</button>
        </div>
      </section>
    </>
  )
}
