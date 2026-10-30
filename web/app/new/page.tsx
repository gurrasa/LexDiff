'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { isAddress, isHex, type Address, type Hex, zeroAddress } from 'viem'
import {
  connectWallet,
  putEvidence,
  type Registration,
  registrationToJson,
  SEPOLIA_MOCK_FORWARDER,
  shortAddr,
  ZERO_BYTES32,
} from '@/lib/registry'
import { type Persona, personas } from '@/lib/identity'
import { type EscrowTerms, escrowTermsSchema } from '@/lib/terms'

const ZERO = '0x0000000000000000000000000000000000000000' as Address

export default function NewAgreement() {
  const router = useRouter()
  const [text, setText] = useState('')
  const [termsJson, setTermsJson] = useState('')
  const [roles, setRoles] = useState({ client: '', freelancer: '', reviewer: '', developer: '' })
  const [verifier, setVerifier] = useState({ forwarder: SEPOLIA_MOCK_FORWARDER as string, workflowOwner: '', workflowId: '' })
  const [supersedes, setSupersedes] = useState('')
  // Usually one person builds the work and gets paid; a separate payee is the exception.
  const [payeeIsDeveloper, setPayeeIsDeveloper] = useState(true)
  // Presentation mode: the demo wallets for each role, so one click fills all three.
  const [demoWallets, setDemoWallets] = useState<Record<Persona, Address> | null>(null)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    personas().then(setDemoWallets)
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

  const extract = () => run('The AI is reading the agreement (10–30 seconds)', () => extractFrom(text))

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
          freelancer: { ...draft.parties.freelancer, wallet: payeeIsDeveloper ? roles.developer : roles.freelancer },
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
        freelancer: (payeeIsDeveloper ? roles.developer : roles.freelancer) as Address,
        // No contract yet: the developer proposes it on the agreement page after both have signed.
        target: zeroAddress,
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

  /** Edits one term in place; the JSON stays the single source of what gets signed. */
  const editTerms = (change: (t: EscrowTerms) => void) => {
    if (!preview) return
    const next = structuredClone(preview)
    change(next)
    setTermsJson(JSON.stringify(next, null, 2))
    resetSignatures()
  }
  const quoteFor = (term: RegExp) => preview?.sourceClauses.find((c) => term.test(c.term))?.quote
  const TERM_ROWS: { label: string; term: RegExp; input: React.ReactNode }[] = preview
    ? [
        {
          label: 'Title',
          term: /^title$/i,
          input: <input value={preview.title} onChange={(e) => editTerms((t) => void (t.title = e.target.value))} aria-label="Title" />,
        },
        {
          label: 'Client',
          term: /parties\.client/i,
          input: <input value={preview.parties.client.name} onChange={(e) => editTerms((t) => void (t.parties.client.name = e.target.value))} aria-label="Client" />,
        },
        {
          label: 'Payee (gets paid)',
          term: /parties\.freelancer/i,
          input: <input value={preview.parties.freelancer.name} onChange={(e) => editTerms((t) => void (t.parties.freelancer.name = e.target.value))} aria-label="Payee" />,
        },
        {
          label: 'Amount',
          term: /amount/i,
          input: (
            <div className="row" style={{ gap: 8, flexWrap: 'nowrap' }}>
              <input value={preview.payment.amount} inputMode="decimal" onChange={(e) => editTerms((t) => void (t.payment.amount = e.target.value.trim()))} aria-label="Amount" />
              <input value={preview.payment.tokenSymbol} style={{ maxWidth: 110 }} onChange={(e) => editTerms((t) => void (t.payment.tokenSymbol = e.target.value.trim()))} aria-label="Token" />
            </div>
          ),
        },
        {
          label: 'Delivery within (days)',
          term: /deliveryPeriod/i,
          input: <input type="number" min={0} value={preview.deadlines.deliveryPeriodDays} onChange={(e) => editTerms((t) => void (t.deadlines.deliveryPeriodDays = Number(e.target.value)))} aria-label="Delivery within (days)" />,
        },
        {
          label: 'Client review period (days)',
          term: /reviewPeriod/i,
          input: <input type="number" min={0} value={preview.deadlines.reviewPeriodDays} onChange={(e) => editTerms((t) => void (t.deadlines.reviewPeriodDays = Number(e.target.value)))} aria-label="Client review period (days)" />,
        },
        {
          label: 'Refund if the deadline is missed',
          term: /refund/i,
          input: (
            <select value={preview.refund.onMissedDeadline ? 'yes' : 'no'} onChange={(e) => editTerms((t) => void (t.refund.onMissedDeadline = e.target.value === 'yes'))} aria-label="Refund if the deadline is missed">
              <option value="yes">Yes</option>
              <option value="no">No</option>
            </select>
          ),
        },
        {
          label: 'Special powers anyone may have',
          term: /adminPowers/i,
          input: <span>{preview.adminPowers.length ? preview.adminPowers.map((p) => p.category).join(', ') : 'None'}</span>,
        },
      ]
    : []
  const matched = new Set(TERM_ROWS.map((r) => quoteFor(r.term)).filter(Boolean))
  const otherQuotes = preview?.sourceClauses.filter((c) => !matched.has(c.quote)) ?? []

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
      <nav aria-label="Breadcrumb" className="crumb">
        <Link href="/">My agreements</Link> / New agreement
      </nav>
      <section className="page-head">
        <div>
          <h1>Check an agreement against its smart contract</h1>
          <p className="lede" style={{ margin: 0 }}>
            Four steps: paste the agreement, check what the AI understood, say who is involved, and sign.
          </p>
        </div>
      </section>
      {error && <p className="error">{error}</p>}
      {busy && <p className="notice" role="status">{busy}…</p>}

      <section className="panel stack">
        <h2 style={{ margin: 0 }}>1. The agreement</h2>
        <p className="small muted" style={{ margin: 0 }}>The signed legal agreement, in plain text. AI will pick out the terms the smart contract must follow.</p>
        <textarea rows={10} value={text} onChange={(e) => setText(e.target.value)} placeholder="Paste the signed agreement…" />
        <div className="row">
          <button onClick={extract} disabled={!!busy || !text.trim()}>Read it with AI</button>
          <button className="ghost" onClick={() => run('Loading', async () => setText(await (await fetch('/demo/freelance-escrow.md')).text()))} disabled={!!busy}>
            Use the demo agreement
          </button>
          {text && (
            <button
              className="ghost small"
              title="Skip the AI wait during a presentation: load terms a lawyer already reviewed"
              onClick={() => run('Loading prepared terms', async () => setTermsJson(await (await fetch('/demo/freelance-escrow.terms.json')).text()))}
              disabled={!!busy}
            >
              Use prepared terms (skip AI)
            </button>
          )}
        </div>
      </section>

      <section className="panel stack" style={{ marginTop: 16 }}>
        <h2 style={{ margin: 0 }}>2. What the AI understood</h2>
        <p className="small muted" style={{ margin: 0 }}>
          AI can be wrong, so a lawyer checks this before anything is signed. Each term comes with the exact sentence it was taken from.
        </p>
        {!termsJson && <p className="muted">Nothing yet. Read an agreement in step 1.</p>}
        {preview && (
          <div className="terms-form" role="table" aria-label="Extracted terms">
            <div className="terms-row head" role="row">
              <span role="columnheader">Term</span>
              <span role="columnheader">What the AI read (you can correct it)</span>
              <span role="columnheader">The agreement says</span>
            </div>
            {TERM_ROWS.map((r) => {
              const quote = quoteFor(r.term)
              return (
                <div key={r.label} className="terms-row" role="row">
                  <span role="rowheader" className="term-label">{r.label}</span>
                  <div role="cell">{r.input}</div>
                  {r.label === 'Title' ? (
                    <span role="cell" />
                  ) : (
                    <blockquote role="cell" className={quote ? '' : 'muted'}>{quote ? `“${quote}”` : 'No quote found. Check this term against the agreement.'}</blockquote>
                  )}
                </div>
              )
            })}
            {otherQuotes.length > 0 && (
              <details>
                <summary>Other sentences the AI quoted ({otherQuotes.length})</summary>
                <ul className="small" style={{ margin: '8px 0 0' }}>
                  {otherQuotes.map((c, i) => <li key={i}><span className="mono">{c.term}</span>: “{c.quote}”</li>)}
                </ul>
              </details>
            )}
          </div>
        )}
        {termsJson && !preview && <p className="error small">The terms are not in the expected format. Correct them under Advanced below.</p>}
      </section>

      <section className="panel stack" style={{ marginTop: 16 }}>
        <h2 style={{ margin: 0 }}>3. Who is involved</h2>
        {demoWallets ? (
          <div className="row">
            <button
              className="small"
              disabled={!!busy}
              onClick={() => {
                resetSignatures()
                setPayeeIsDeveloper(true)
                setRoles(() => ({ reviewer: demoWallets.lawyer, client: demoWallets.client, developer: demoWallets.developer, freelancer: demoWallets.developer }))
              }}
            >
              Fill in the demo roles
            </button>
            <span className="small muted">
              Each role gets its own demo wallet. You switch between them with Lawyer, Client and Developer in the header.
            </span>
          </div>
        ) : (
          <div className="row">
            <button className="ghost small" onClick={() => run('Connecting wallet', async () => {
              const { account } = await connectWallet()
              resetSignatures()
              setRoles((r) => ({ client: r.client || account, freelancer: r.freelancer || account, reviewer: r.reviewer || account, developer: r.developer || account }))
            })} disabled={!!busy}>Use my wallet for empty roles</button>
            <span className="small muted">
              Testing alone? One wallet can hold every role. On the agreement page you then switch with Act as.
            </span>
          </div>
        )}
        <div className="grid two">
          <div><label>Lawyer (you): approves the terms</label>{field(roles.reviewer, (v) => setRoles({ ...roles, reviewer: v }))}</div>
          <div><label>Client: pays into the escrow</label>{field(roles.client, (v) => setRoles({ ...roles, client: v }))}</div>
          <div>
            <label>Developer: builds, fixes the contract and gets paid</label>
            {field(roles.developer, (v) => setRoles({ ...roles, developer: v, freelancer: payeeIsDeveloper ? v : roles.freelancer }))}
          </div>
          <div>
            <label className="toggle" style={{ marginBottom: 4 }}>
              <input
                type="checkbox"
                checked={payeeIsDeveloper}
                onChange={(e) => {
                  setPayeeIsDeveloper(e.target.checked)
                  if (e.target.checked) setRoles({ ...roles, freelancer: roles.developer })
                }}
              />{' '}
              The developer is the one who gets paid
            </label>
            {!payeeIsDeveloper && (
              <>
                <label>Payee: who the escrow pays out to</label>
                {field(roles.freelancer, (v) => setRoles({ ...roles, freelancer: v }))}
              </>
            )}
          </div>
        </div>
        <p className="small muted" style={{ margin: 0 }}>
          <b>The smart contract comes later.</b> Once the lawyer and the client have signed, the developer deploys the escrow
          contract with these client and payee wallets and proposes it on the agreement page. The client approves it, and that
          starts the Chainlink check.
        </p>
      </section>

      <details className="panel" style={{ marginTop: 16 }}>
        <summary>Advanced: raw terms, verifier and amendments</summary>
        <div className="stack" style={{ marginTop: 12 }}>
          <div>
            <label>Terms as JSON (exactly what is signed)</label>
            <textarea rows={14} value={termsJson} placeholder="Read an agreement in step 1 first." onChange={(e) => { setTermsJson(e.target.value); resetSignatures() }} />
          </div>
          <div className="grid two">
            <div><label>Chainlink CRE forwarder</label>{field(verifier.forwarder, (v) => setVerifier({ ...verifier, forwarder: v }))}</div>
            <div><label>Workflow owner (optional)</label>{field(verifier.workflowOwner, (v) => setVerifier({ ...verifier, workflowOwner: v }))}</div>
            <div><label>Workflow ID (optional)</label>{field(verifier.workflowId, (v) => setVerifier({ ...verifier, workflowId: v }), '0x… 32 bytes')}</div>
            <div><label>This amends agreement # (optional)</label>{field(supersedes, setSupersedes, 'e.g. 1')}</div>
          </div>
          <p className="small muted" style={{ margin: 0 }}>
            The verifier decides who may mark issues as fixed. The default is the Chainlink simulation forwarder used in this demo.
            It is locked in when you sign.
          </p>
        </div>
      </details>

      <section className="panel stack" style={{ marginTop: 16 }}>
        <h2 style={{ margin: 0 }}>4. Save and send for signatures</h2>
        <p className="small muted" style={{ margin: 0 }}>
          Saving creates a signing page. The lawyer and the client each open it and sign with their own wallet. That records
          who approved the AI&apos;s reading of the agreement. Only fingerprints (hashes) go on the blockchain; the terms stay private.
        </p>
        <div className="row">
          <button onClick={publish} disabled={!!busy || !preview}>Save the approved terms and create the signing link</button>
        </div>
      </section>
    </>
  )
}
