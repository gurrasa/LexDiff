'use client'

import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import { useCallback, useEffect, useState } from 'react'
import { type Address, type Hex, zeroAddress } from 'viem'
import {
  type AgreementDocument,
  connectWallet,
  DOMAIN,
  EXPLORER,
  autoUnlock,
  getEvidence,
  type PendingRegistration,
  REGISTRATION_TYPES,
  registrationFromJson,
  same,
  SEPOLIA_MOCK_FORWARDER,
  shortAddr,
  storedAccess,
  submitSigned,
  unlockAccess,
  watchAccount,
} from '@/lib/registry'
import { PERSONA_LABEL, personas, setPersona } from '@/lib/identity'
import type { EscrowTerms } from '@/lib/terms'

type Role = 'client' | 'reviewer'

const WHAT_YOU_SIGN: Record<Role, string> = {
  reviewer: 'As the lawyer, you confirm these terms are a correct reading of the full agreement below. This records who approved the AI extraction.',
  client: 'As the client, you confirm the full agreement, these terms, the parties, this contract and this checker.',
}

export default function SignView() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const [pending, setPending] = useState<PendingRegistration | null>(null)
  const [terms, setTerms] = useState<EscrowTerms | null>(null)
  const [document, setDocument] = useState<AgreementDocument | null>(null)
  const [account, setAccount] = useState<Address | null>(null)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)
  const [presenting, setPresenting] = useState(false)

  const load = useCallback(async () => {
    const res = await fetch(`/api/registrations/${id}`)
    const body = await res.json()
    if (!res.ok) throw new Error(body.error)
    const p = { ...body, registration: registrationFromJson(body.registration) } as PendingRegistration
    setPending(p)
    setTerms(await getEvidence<EscrowTerms>(p.registration.termsHash, p.registration.termsURI))
    // The full agreement is private to the parties: it loads once the reader has a read pass.
    await autoUnlock(account)
    setDocument(await getEvidence<AgreementDocument>(p.registration.agreementHash, undefined, { registrationId: id as Hex, account }))
  }, [id, account])

  useEffect(() => {
    load().catch((e) => setError(String(e.message ?? e)))
  }, [load])

  useEffect(() => {
    personas().then((p) => setPresenting(!!p))
    return watchAccount(setAccount)
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

  if (error && !pending) return <p className="error">{error}</p>
  if (!pending) return <p className="muted">Loading the registration…</p>

  const r = pending.registration
  const sigs = pending.signatures
  const oneSigner = same(r.client, r.reviewer)
  const myRoles = (['reviewer', 'client'] as Role[]).filter((role) => account && same(account, r[role]))
  const toSign = myRoles.filter((role) => !sigs[role])
  const isParty = !!account && [r.client, r.reviewer, r.developer, r.freelancer].some((x) => same(x, account))
  const bothSigned = !!sigs.client && !!sigs.reviewer
  const expired = Date.now() / 1000 > Number(r.deadline)
  const link = typeof window === 'undefined' ? '' : window.location.href

  const sign = () =>
    run('Waiting for your signature in MetaMask', async () => {
      const { wallet, account } = await connectWallet()
      const role = (['reviewer', 'client'] as Role[]).find((x) => same(account, r[x]) && !sigs[x])
      if (!role) throw new Error('This wallet has nothing left to sign here.')
      const signature = await wallet.signTypedData({ account, domain: DOMAIN(), types: REGISTRATION_TYPES, primaryType: 'Registration', message: r })
      setBusy('Saving your signature')
      const res = await fetch(`/api/registrations/${id}`, { method: 'POST', body: JSON.stringify({ role, signature }) })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error)
      await load()
    })

  const register = () =>
    run('Registering on Sepolia', async () => {
      // Both signatures are already collected, so the app's relayer can submit it: nobody needs gas for this.
      const { agreementId } = await submitSigned('registerAgreement', [r, sigs.client, sigs.reviewer])
      if (!agreementId) throw new Error('Registered, but the agreement number could not be read. Check the agreements list.')
      await fetch(`/api/registrations/${id}`, { method: 'POST', body: JSON.stringify({ agreementId }) })
      router.push(`/agreements/${agreementId}`)
    })

  const party = (label: string, role: Role | null, address: Address) => (
    <tr>
      <td><b>{label}</b></td>
      <td className="mono small">
        {shortAddr(address)}
        {account && same(account, address) && <span className="badge tone-info" style={{ marginLeft: 6 }}>you</span>}
      </td>
      <td>
        {role === null ? (
          <span className="muted small">no signature needed</span>
        ) : sigs[role] ? (
          <span className="badge tone-ok">✓ signed</span>
        ) : (
          <span className="badge tone-warn">waiting</span>
        )}
      </td>
    </tr>
  )

  return (
    <>
      <span className="muted small">Registration request</span>
      <h1>{terms?.title ?? 'Agreement'}</h1>
      <p className="lede">
        Before this agreement is registered, the lawyer and the client each sign exactly these terms with their own wallet.
        Send this page to whoever still needs to sign.
      </p>
      {pending.agreementId && (
        <p className="notice">Registered as <Link href={`/agreements/${pending.agreementId}`}>agreement #{pending.agreementId}</Link>.</p>
      )}
      {expired && !pending.agreementId && <p className="error">This request has expired. The lawyer needs to save the terms again.</p>}
      {error && <p className="error">{error}</p>}
      {busy && <p className="notice">{busy}…</p>}

      <div className="grid two" style={{ marginTop: '1rem' }}>
        <section className="panel stack">
          <h2 style={{ margin: 0 }}>What is being signed</h2>
          {terms ? (
            <>
              <ul style={{ margin: 0 }}>
                <li>{terms.parties.client.name} pays <b>{terms.payment.amount} {terms.payment.tokenSymbol}</b> into the escrow</li>
                <li>{terms.parties.freelancer.name} delivers within <b>{terms.deadlines.deliveryPeriodDays} days</b></li>
                <li>Client review period: <b>{terms.deadlines.reviewPeriodDays} days</b></li>
                <li>Refund if the deadline is missed: <b>{terms.refund.onMissedDeadline ? 'yes' : 'no'}</b></li>
                <li>Special powers anyone may have: <b>{terms.adminPowers.length ? terms.adminPowers.map((p) => p.category).join(', ') : 'none'}</b></li>
              </ul>
              <details>
                <summary>Where each term comes from</summary>
                <ul className="small">{terms.sourceClauses.map((c, i) => <li key={i}>“{c.quote}”</li>)}</ul>
              </details>
            </>
          ) : (
            <p className="error small">The terms could not be loaded or do not match their fingerprint.</p>
          )}
          <div className="small">
            Smart contract that will hold the money:{' '}
            {same(r.target, zeroAddress) ? (
              <span className="muted">the developer builds and proposes it after you both sign; the client approves it before any money goes in.</span>
            ) : (
              <a className="mono" href={`${EXPLORER}/address/${r.target}#code`} target="_blank" rel="noreferrer">{shortAddr(r.target)}</a>
            )}
          </div>
          <div className="small">
            Checked by: Chainlink CRE{' '}
            {same(r.verifier.forwarder, SEPOLIA_MOCK_FORWARDER) ? <span className="badge tone-warn">simulation</span> : <span className="badge tone-ok">production</span>}
          </div>
          {document ? (
            <details>
              <summary>The full agreement being signed</summary>
              <pre style={{ whiteSpace: 'pre-wrap' }}>{document.text}</pre>
            </details>
          ) : isParty && !storedAccess(account) ? (
            <div>
              <button className="ghost small" disabled={!!busy} onClick={() => run('Unlocking the agreement', async () => { await unlockAccess(); await load() })}>
                🔒 Show the full agreement
              </button>
              <div className="muted small">Private to the parties. Your wallet signs a read pass (no transaction, valid for 24 hours).</div>
            </div>
          ) : isParty ? (
            <p className="error small">The full agreement could not be loaded or does not match its fingerprint.</p>
          ) : (
            <p className="muted small">🔒 The full agreement is private to the parties. Connect the wallet named below to read it.</p>
          )}
          <div className="small muted">
            Agreement fingerprint {r.agreementHash.slice(0, 18)}… · terms fingerprint {r.termsHash.slice(0, 18)}…
          </div>
        </section>

        <section className="panel stack">
          <h2 style={{ margin: 0 }}>Who signs</h2>
          <table>
            <tbody>
              {party(oneSigner ? 'Lawyer & client' : 'Lawyer (reviewer)', 'reviewer', r.reviewer)}
              {!oneSigner && party('Client', 'client', r.client)}
              {party('Developer', null, r.developer)}
              {party('Freelancer', null, r.freelancer)}
            </tbody>
          </table>

          {!account ? (
            <button onClick={() => run('Connecting', async () => setAccount((await connectWallet()).account))} disabled={!!busy}>Connect wallet</button>
          ) : toSign.length > 0 && !expired && !pending.agreementId ? (
            <>
              {toSign.map((role) => <p key={role} className="small" style={{ margin: 0 }}>{WHAT_YOU_SIGN[role]}</p>)}
              <button onClick={sign} disabled={!!busy}>Sign as {toSign.map((x) => (x === 'reviewer' ? 'lawyer' : 'client')).join(' and ')}</button>
            </>
          ) : myRoles.length === 0 && !bothSigned ? (
            <p className="small muted">This wallet ({shortAddr(account)}) is not asked to sign. Switch account in MetaMask if you are the lawyer or the client.</p>
          ) : null}

          {bothSigned && !pending.agreementId && (
            <>
              <p className="small" style={{ margin: 0 }}>Both have signed. Anyone can now put it on the blockchain.</p>
              <button onClick={register} disabled={!!busy || expired}>Register on the blockchain</button>
            </>
          )}

          {presenting && !bothSigned && toSign.length === 0 && (
            <div className="row">
              {!sigs.reviewer && <button onClick={() => setPersona('lawyer')}>Switch to {PERSONA_LABEL.lawyer.icon} Lawyer ▸</button>}
              {sigs.reviewer && !sigs.client && <button onClick={() => setPersona('client')}>Switch to {PERSONA_LABEL.client.icon} Client ▸</button>}
            </div>
          )}

          {!bothSigned && (
            <div className="stack">
              <label>Share this link with whoever still needs to sign</label>
              <div className="row">
                <input className="mono small" readOnly value={link} onFocus={(e) => e.target.select()} />
                <button className="ghost small" onClick={() => navigator.clipboard.writeText(link).then(() => setCopied(true))}>
                  {copied ? 'Copied' : 'Copy'}
                </button>
              </div>
            </div>
          )}
        </section>
      </div>
    </>
  )
}
