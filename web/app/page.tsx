'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { type Address, type Hex, zeroAddress } from 'viem'
import { ROLES, type Role, rolesOf, STEPS, stageOf } from '@/lib/plain'
import {
  type Agreement,
  type Check,
  connectWallet,
  type Finding,
  getEvidence,
  REGISTRY_ADDRESS,
  registry,
  same,
  shortAddr,
  watchAccount,
} from '@/lib/registry'
import type { EscrowTerms } from '@/lib/terms'

type Row = { id: bigint; agreement: Agreement; terms: EscrowTerms | null; findings: Finding[]; checks: Check[] }
type Pending = { id: Hex; title: string; role: 'client' | 'reviewer'; other: string }

/** Whether the next step of this agreement is for one of `roles`. The client can also act while decisions are open. */
const myTurn = (row: Row, roles: Role[]) => {
  const w = stageOf(row.agreement, row.findings, row.checks).waitingFor
  return !!w && w !== 'chainlink' && (roles.includes(w) || (w === 'reviewer' && roles.includes('client')))
}

export default function Home() {
  const [rows, setRows] = useState<Row[] | null>(null)
  const [account, setAccount] = useState<Address | null>(null)
  const [pending, setPending] = useState<Pending[]>([])
  const [error, setError] = useState('')

  useEffect(() => watchAccount(setAccount), [])

  useEffect(() => {
    if (!REGISTRY_ADDRESS) return
    ;(async () => {
      const count = await registry.agreementCount()
      const ids = Array.from({ length: Number(count) }, (_, i) => BigInt(i + 1)).reverse()
      setRows(
        await Promise.all(
          ids.map(async (id) => {
            const agreement = await registry.getAgreement(id)
            const [terms, findings, checks] = await Promise.all([
              getEvidence<EscrowTerms>(agreement.termsHash, agreement.termsURI),
              registry.getFindings(id),
              registry.getChecks(id),
            ])
            return { id, agreement, terms, findings, checks }
          }),
        ),
      )
    })().catch((e) => setError(String(e?.shortMessage ?? e)))
  }, [])

  // Signing requests waiting for this wallet.
  useEffect(() => {
    setPending([])
    if (!account) return
    fetch(`/api/registrations?address=${account}`)
      .then((r) => r.json())
      .then(async (list: { id: Hex; registration: Record<string, string> }[]) => {
        setPending(
          await Promise.all(
            list.map(async (p) => {
              const r = p.registration
              const terms = await getEvidence<EscrowTerms>(r.termsHash as Hex, r.termsURI)
              const role = same(account, r.reviewer) ? 'reviewer' : 'client'
              return { id: p.id, title: terms?.title ?? 'Agreement', role, other: role === 'reviewer' ? r.client : r.reviewer }
            }),
          ),
        )
      })
      .catch(() => {})
  }, [account])

  const mine = rows?.filter((r) => rolesOf(r.agreement, account).length > 0) ?? []
  const others = rows?.filter((r) => rolesOf(r.agreement, account).length === 0) ?? []
  const yourTurn = mine.filter((r) => myTurn(r, rolesOf(r.agreement, account)))
  const waiting = mine.filter((r) => !myTurn(r, rolesOf(r.agreement, account)))

  const card = (row: Row, highlight: boolean) => {
    const roles = rolesOf(row.agreement, account)
    const stage = stageOf(row.agreement, row.findings, row.checks)
    return (
      <Link
        key={row.id.toString()}
        href={`/agreements/${row.id}`}
        className="panel row spread"
        style={{ color: 'inherit', borderColor: highlight ? 'var(--accent)' : undefined, borderWidth: highlight ? 2 : 1 }}
      >
        <div>
          <h3 style={{ margin: 0 }}>{row.terms?.title ?? `Agreement #${row.id}`}</h3>
          <span className="small muted">
            #{row.id.toString()} · {same(row.agreement.target, zeroAddress) ? 'no contract yet' : `contract ${shortAddr(row.agreement.target)}`}
            {roles.length > 0 && <> · you are the {roles.map((r) => ROLES[r].label.toLowerCase()).join(' & ')}</>}
          </span>
        </div>
        <div style={{ textAlign: 'right', maxWidth: 360 }}>
          <span className={`badge ${stage.waitingFor === null ? 'tone-ok' : highlight ? 'tone-info' : 'tone-muted'}`}>
            {highlight ? 'Your turn' : STEPS[stage.step]}
          </span>
          <div className="small muted">
            {stage.title}
            {!highlight && stage.waitingFor && ` · waiting for ${stage.waitingFor === 'chainlink' ? 'Chainlink' : `the ${ROLES[stage.waitingFor].label.toLowerCase()}`}`}
          </div>
        </div>
      </Link>
    )
  }

  if (!REGISTRY_ADDRESS) {
    return <p className="notice">Set <code>NEXT_PUBLIC_REGISTRY_ADDRESS</code> in <code>web/.env.local</code> to the deployed LexDiffRegistry.</p>
  }

  return (
    <>
      {!account ? (
        <section className="hero">
          <h1>Does the smart contract do what the parties signed?</h1>
          <p className="lede">
            LexDiff checks a smart contract against the agreement it is meant to enforce, and keeps a signed record of who knew about
            each problem, who accepted it, and whether a fix was verified.
          </p>
          <div className="row" style={{ marginTop: '1rem' }}>
            <button onClick={() => connectWallet().then((w) => setAccount(w.account)).catch((e) => setError(e.message))}>
              Connect your wallet to see your agreements
            </button>
            <a href="#how" className="button ghost">How it works</a>
          </div>
        </section>
      ) : (
        <section style={{ margin: '1.5rem 0 1rem' }}>
          <h1 style={{ marginBottom: 4 }}>Your agreements</h1>
          <p className="muted" style={{ margin: 0 }}>
            Signed in as <span className="mono">{shortAddr(account)}</span>. Switch account in MetaMask to see another person&apos;s view.
          </p>
        </section>
      )}
      {error && <p className="error">{error}</p>}

      {account && (
        <>
          {pending.length > 0 && (
            <>
              <h2>Waiting for your signature</h2>
              <div className="stack">
                {pending.map((p) => (
                  <Link key={p.id} href={`/sign/${p.id}`} className="panel row spread" style={{ color: 'inherit', borderColor: 'var(--accent)', borderWidth: 2 }}>
                    <div>
                      <h3 style={{ margin: 0 }}>{p.title}</h3>
                      <span className="small muted">You sign as the {p.role === 'reviewer' ? 'lawyer' : 'client'} · {p.role === 'reviewer' ? 'client' : 'lawyer'} {shortAddr(p.other)}</span>
                    </div>
                    <span className="button small">Review and sign</span>
                  </Link>
                ))}
              </div>
            </>
          )}

          <h2>Your turn</h2>
          {rows === null && <p className="muted">Loading from Sepolia…</p>}
          {rows && yourTurn.length === 0 && pending.length === 0 && <p className="muted">Nothing needs you right now.</p>}
          <div className="stack">{yourTurn.map((r) => card(r, true))}</div>

          {waiting.length > 0 && (
            <>
              <h2>Waiting for others</h2>
              <div className="stack">{waiting.map((r) => card(r, false))}</div>
            </>
          )}

          {rows && mine.length === 0 && pending.length === 0 && (
            <div className="panel" style={{ marginTop: '1rem' }}>
              <p style={{ margin: 0 }}>
                You are not part of any agreement yet. A <b>lawyer</b> starts one with <Link href="/new">New agreement</Link> and sends
                the client a signing link. The developer and the freelancer see the agreement here once it is registered with their wallet.
              </p>
            </div>
          )}
        </>
      )}

      {others.length > 0 && (
        <details style={{ marginTop: '2rem' }}>
          <summary>Other agreements on this registry ({others.length})</summary>
          <div className="stack" style={{ marginTop: '0.75rem' }}>{others.map((r) => card(r, false))}</div>
        </details>
      )}

      <h2 id="how">How it works</h2>
      <ol className="steps">
        <li><b>Agreement signed.</b> The lawyer pastes the agreement; Claude extracts the terms with a quote for each. The lawyer and the client both sign the full agreement and the terms.</li>
        <li><b>Contract.</b> The developer builds the escrow contract and proposes it; the client approves it as the contract to fund. No money moves yet.</li>
        <li><b>Code checked.</b> Chainlink, which no party controls, reads the smart contract on Sepolia and checks every term: Pass or Fail.</li>
        <li><b>Decisions.</b> For each failing property the lawyer can require a fix, or the client can knowingly accept the risk. Anyone involved can confirm they saw it, or dispute it.</li>
        <li><b>Fix.</b> The developer deploys a corrected contract and proposes it; the client approves it.</li>
        <li><b>Re-check.</b> Chainlink checks again. A fix is verified only when the same property now passes.</li>
        <li><b>Decided.</b> Every failing property is verified as fixed or has a signed decision. An accepted risk still shows Fail. Now the client can fund the approved contract.</li>
      </ol>

      <h2>Who is involved</h2>
      <div className="grid four">
        <div className="panel"><h3>Lawyer</h3><p className="small">Starts the agreement, approves Claude&apos;s reading of it, and decides which failures must be fixed.</p></div>
        <div className="panel"><h3>Client</h3><p className="small">Signs the agreement, can knowingly accept a risk, and approves which contract to fund.</p></div>
        <div className="panel"><h3>Developer</h3><p className="small">Wrote the contract. Fixes failing properties and proposes the corrected version.</p></div>
        <div className="panel"><h3>Chainlink</h3><p className="small">Independent checker. The only one that can verify a fix.</p></div>
      </div>

      <p className="small muted" style={{ marginTop: '2rem' }}>
        LexDiff keeps evidence; it does not decide who is liable. A wallet signature proves control of a key, not someone&apos;s legal identity.
        Only fingerprints (hashes) are stored on the blockchain; the agreement, terms and notes stay off-chain.
      </p>
    </>
  )
}
