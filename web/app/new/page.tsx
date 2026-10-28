'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { decodeEventLog, isAddress, type Address } from 'viem'
import { connectWallet, registryAbi, writeRegistry } from '@/lib/registry'
import { type EscrowTerms, escrowTermsSchema } from '@/lib/terms'

export default function NewAgreement() {
  const router = useRouter()
  const [text, setText] = useState('')
  const [termsJson, setTermsJson] = useState('')
  const [roles, setRoles] = useState({ client: '', freelancer: '', reviewer: '', developer: '', target: '' })
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')

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

  const loadDemo = () => run('Loading', async () => setText(await (await fetch('/demo/freelance-escrow.md')).text()))

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
    })

  const fillMe = () =>
    run('Connecting wallet', async () => {
      const { account } = await connectWallet()
      setRoles((r) => ({
        ...r,
        client: r.client || account,
        freelancer: r.freelancer || account,
        reviewer: r.reviewer || account,
        developer: r.developer || account,
      }))
    })

  const register = () =>
    run('Registering', async () => {
      for (const [k, v] of Object.entries(roles)) if (!isAddress(v)) throw new Error(`${k} must be an address`)
      const terms = escrowTermsSchema.parse({
        ...JSON.parse(termsJson),
        parties: {
          client: { ...JSON.parse(termsJson).parties.client, wallet: roles.client },
          freelancer: { ...JSON.parse(termsJson).parties.freelancer, wallet: roles.freelancer },
        },
      })
      setBusy('Publishing reviewed terms')
      const res = await fetch('/api/terms', { method: 'POST', body: JSON.stringify(terms) })
      const published = await res.json()
      if (!res.ok) throw new Error(published.error)

      setBusy('Waiting for registerAgreement transaction')
      const receipt = await writeRegistry('registerAgreement', [
        roles.client as Address,
        roles.reviewer as Address,
        roles.developer as Address,
        roles.target as Address,
        published.hash,
        published.uri,
        terms.title,
      ])
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

  return (
    <>
      <h1>Register an agreement</h1>
      <p className="lede">
        Claude drafts the structured terms. A lawyer reviews and corrects them. Only the reviewed terms are hashed and
        registered, and that hash is what the CRE workflow verifies before it compares anything.
      </p>
      {error && <p className="error">{error}</p>}
      {busy && <p className="notice">{busy}…</p>}

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
          <textarea rows={14} value={termsJson} onChange={(e) => setTermsJson(e.target.value)} placeholder="Extracted terms appear here and can be edited." />
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
            ] as const
          ).map(([k, label]) => (
            <div key={k}>
              <label>{label}</label>
              <input className="mono" value={roles[k]} onChange={(e) => setRoles({ ...roles, [k]: e.target.value })} placeholder="0x…" />
            </div>
          ))}
        </div>
        <div>
          <label>Deployed contract (Sepolia, verified on Etherscan)</label>
          <input className="mono" value={roles.target} onChange={(e) => setRoles({ ...roles, target: e.target.value })} placeholder="0x…" />
        </div>
        <button onClick={register} disabled={!!busy || !preview}>Publish terms &amp; register on-chain</button>
        <p className="small muted">
          Registering emits <code>CheckRequested</code>, which the CRE workflow&apos;s log trigger picks up.
        </p>
      </section>
    </>
  )
}
