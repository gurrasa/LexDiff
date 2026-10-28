'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
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
import { type EscrowTerms, escrowTermsSchema } from '@/lib/terms'

const ZERO = '0x0000000000000000000000000000000000000000' as Address

export default function NewAgreement() {
  const router = useRouter()
  const [text, setText] = useState('')
  const [termsJson, setTermsJson] = useState('')
  const [roles, setRoles] = useState({ client: '', freelancer: '', reviewer: '', developer: '', target: '' })
  const [verifier, setVerifier] = useState({ forwarder: SEPOLIA_MOCK_FORWARDER as string, workflowOwner: '', workflowId: '' })
  const [supersedes, setSupersedes] = useState('')
  const [registration, setRegistration] = useState<Registration | null>(null)
  const [sigs, setSigs] = useState<{ client?: Hex; reviewer?: Hex }>({})
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

  // Anything edited after publishing invalidates the signatures collected so far.
  const resetSignatures = () => {
    setRegistration(null)
    setSigs({})
  }

  const loadDemo = () => run('Loading', async () => setText(await (await fetch('/demo/freelance-escrow.md')).text()))

  const extract = () =>
    run('Extracting with Claude', async () => {
      const res = await fetch('/api/extract', { method: 'POST', body: JSON.stringify({ text }) })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error)
      const terms = body.terms as EscrowTerms
      resetSignatures()
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
      resetSignatures()
      setRoles((r) => ({
        ...r,
        client: r.client || account,
        freelancer: r.freelancer || account,
        reviewer: r.reviewer || account,
        developer: r.developer || account,
      }))
    })

  const publish = () =>
    run('Publishing reviewed terms', async () => {
      for (const [k, v] of Object.entries(roles)) if (!isAddress(v)) throw new Error(`${k} must be an address`)
      if (!isAddress(verifier.forwarder)) throw new Error('forwarder must be an address')
      if (verifier.workflowOwner && !isAddress(verifier.workflowOwner)) throw new Error('workflow owner must be an address')
      if (verifier.workflowId && !(isHex(verifier.workflowId) && verifier.workflowId.length === 66)) {
        throw new Error('workflow ID must be 32 bytes hex')
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
    run(`Signing as ${role}`, async () => {
      if (!registration) return
      const { wallet, account } = await connectWallet()
      if (!same(account, registration[role])) {
        throw new Error(`Switch your wallet to the ${role} account ${shortAddr(registration[role])}`)
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

  const register = () =>
    run('Waiting for registerAgreement transaction', async () => {
      if (!registration || !sigs.client || !sigs.reviewer) return
      const receipt = await writeRegistry('registerAgreement', [registration, sigs.client, sigs.reviewer])
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

  return (
    <>
      <h1>Register an agreement</h1>
      <p className="lede">
        Claude drafts the structured terms. Counsel reviews and corrects them. The client and the reviewer then sign the
        reviewed terms, the roles and the verifier. Only hashes go on-chain; the terms stay in the evidence store.
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
          <textarea
            rows={14}
            value={termsJson}
            onChange={(e) => {
              setTermsJson(e.target.value)
              resetSignatures()
            }}
            placeholder="Extracted terms appear here and can be edited."
          />
        </section>
      </div>

      <section className="panel stack" style={{ marginTop: '1rem' }}>
        <div className="row spread">
          <h3 style={{ margin: 0 }}>3 · Parties, contract and verifier</h3>
          <button className="ghost small" onClick={fillMe} disabled={!!busy}>Use my wallet for empty roles (demo)</button>
        </div>
        <div className="grid four">
          <div><label>Client (accepts risk, approves redeploys)</label>{field(roles.client, (v) => setRoles({ ...roles, client: v }))}</div>
          <div><label>Freelancer</label>{field(roles.freelancer, (v) => setRoles({ ...roles, freelancer: v }))}</div>
          <div><label>Reviewer / counsel (approves terms)</label>{field(roles.reviewer, (v) => setRoles({ ...roles, reviewer: v }))}</div>
          <div><label>Developer (fixes)</label>{field(roles.developer, (v) => setRoles({ ...roles, developer: v }))}</div>
        </div>
        <div className="grid two">
          <div><label>Deployed contract (Sepolia, verified on Etherscan)</label>{field(roles.target, (v) => setRoles({ ...roles, target: v }))}</div>
          <div><label>Amends agreement # (optional)</label>{field(supersedes, setSupersedes, 'e.g. 1')}</div>
        </div>
        <details>
          <summary>Verifier: who may resolve findings for this agreement</summary>
          <div className="grid two" style={{ marginTop: '0.5rem' }}>
            <div><label>CRE forwarder</label>{field(verifier.forwarder, (v) => setVerifier({ ...verifier, forwarder: v }))}</div>
            <div><label>Workflow owner (pin, optional)</label>{field(verifier.workflowOwner, (v) => setVerifier({ ...verifier, workflowOwner: v }))}</div>
            <div><label>Workflow ID (pin, optional)</label>{field(verifier.workflowId, (v) => setVerifier({ ...verifier, workflowId: v }), '0x… 32 bytes')}</div>
          </div>
          <p className="small muted">
            Defaults to the Sepolia MockKeystoneForwarder used by <code>cre workflow simulate</code>. The mock does not verify DON
            signatures; for production use the KeystoneForwarder and pin the workflow owner and ID. Nobody can change this after signing.
          </p>
        </details>
      </section>

      <section className="panel stack" style={{ marginTop: '1rem' }}>
        <h3 style={{ margin: 0 }}>4 · Sign and register</h3>
        <ol className="steps">
          <li>
            <div className="row spread">
              <span>Publish the reviewed terms to the evidence store and fix the registration.</span>
              <button onClick={publish} disabled={!!busy || !preview}>{registration ? 'Republish' : 'Publish terms'}</button>
            </div>
            {registration && <div className="small muted mono">terms hash {registration.termsHash}</div>}
          </li>
          <li>
            <div className="row spread">
              <span>The <b>reviewer</b> signs: “I reviewed these terms against the agreement.” This is the record of who approved the AI extraction.</span>
              {sigs.reviewer ? <span className="badge tone-ok">✓ signed</span> : <button onClick={() => sign('reviewer')} disabled={!!busy || !registration}>Sign as reviewer</button>}
            </div>
          </li>
          <li>
            <div className="row spread">
              <span>The <b>client</b> signs the same terms, roles and verifier.</span>
              {sigs.client ? <span className="badge tone-ok">✓ signed</span> : <button onClick={() => sign('client')} disabled={!!busy || !registration}>Sign as client</button>}
            </div>
          </li>
          <li>
            <div className="row spread">
              <span>Register on-chain. Anyone may submit; this emits <code>CheckRequested</code> for the CRE log trigger.</span>
              <button onClick={register} disabled={!!busy || !sigs.client || !sigs.reviewer}>Register</button>
            </div>
          </li>
        </ol>
      </section>
    </>
  )
}
