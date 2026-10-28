'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { STEPS, stageOf } from '@/lib/plain'
import { type Agreement, type Check, type Finding, getEvidence, REGISTRY_ADDRESS, registry, shortAddr } from '@/lib/registry'
import type { EscrowTerms } from '@/lib/terms'

type Row = { id: bigint; agreement: Agreement; terms: EscrowTerms | null; findings: Finding[]; checks: Check[] }

export default function Home() {
  const [rows, setRows] = useState<Row[] | null>(null)
  const [error, setError] = useState('')

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

  return (
    <>
      <section className="hero">
        <h1>Does the smart contract do what the parties signed?</h1>
        <p className="lede">
          More and more agreements are enforced by code, and more and more of that code is written by AI. LexDiff checks the code against the
          agreement, and keeps a signed record of who knew about each problem, who accepted it, and whether it was really fixed.
        </p>
        <div className="row" style={{ marginTop: '1rem' }}>
          <Link href="/new" className="button">Try it with the demo agreement</Link>
          <a href="#how" className="button ghost">How it works</a>
        </div>
      </section>

      <div className="story">
        <div className="panel">
          <h3>📄 The agreement says</h3>
          <p>The client deposits 1,000 USDC. The freelancer delivers within <b>30 days</b>. If not, the client gets a <b>refund</b>. Nobody may withdraw the money.</p>
        </div>
        <div className="panel">
          <h3>💻 The code does</h3>
          <p>⚠️ The deadline is <b>3 days</b>.<br />❌ There is <b>no refund</b>.<br />🚩 The owner can <b>withdraw everything</b>.</p>
        </div>
        <div className="panel">
          <h3>🔎 LexDiff records</h3>
          <p>Chainlink finds all three. The lawyer has the developer fix two; the client knowingly accepts one. Chainlink confirms the fix. Everything is signed.</p>
        </div>
      </div>

      {!REGISTRY_ADDRESS && (
        <p className="notice">
          Set <code>NEXT_PUBLIC_REGISTRY_ADDRESS</code> in <code>web/.env.local</code> to the deployed LexDiffRegistry to see agreements.
        </p>
      )}
      {error && <p className="error">{error}</p>}

      {REGISTRY_ADDRESS && (
        <>
          <h2>Agreements</h2>
          <div className="stack">
            {rows === null && !error && <p className="muted">Loading from Sepolia…</p>}
            {rows?.length === 0 && <p className="muted">No agreements yet. <Link href="/new">Register the first one.</Link></p>}
            {rows?.map(({ id, agreement, terms, findings, checks }) => {
              const stage = stageOf(agreement, findings, checks)
              return (
                <Link key={id.toString()} href={`/agreements/${id}`} className="panel row spread" style={{ color: 'inherit' }}>
                  <div>
                    <h3 style={{ margin: 0 }}>{terms?.title ?? `Agreement #${id}`}</h3>
                    <span className="small muted">
                      #{id.toString()} · contract {shortAddr(agreement.target)}
                      {agreement.supersededBy > BigInt(0) && ` · amended by #${agreement.supersededBy}`}
                    </span>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <span className={`badge ${stage.waitingFor === null ? 'tone-ok' : 'tone-info'}`}>
                      {STEPS[stage.step]}
                    </span>
                    <div className="small muted">{stage.title}</div>
                  </div>
                </Link>
              )
            })}
          </div>
        </>
      )}

      <h2 id="how">How it works</h2>
      <ol className="steps">
        <li><b>Agreement signed.</b> Claude reads the agreement and picks out the terms, quoting where each one comes from. The lawyer checks them, and the lawyer and client sign.</li>
        <li><b>Code checked.</b> Chainlink, which no party controls, reads the smart contract on the blockchain and compares it with the signed terms.</li>
        <li><b>Decisions.</b> For each problem the lawyer can require a fix, or the client can knowingly accept the risk. Anyone involved can confirm they saw it, or disagree.</li>
        <li><b>Fix.</b> The developer deploys a corrected contract; the client, who holds the money, approves the switch.</li>
        <li><b>Re-check.</b> Chainlink checks again. Only Chainlink can mark a problem as fixed; saying so is not enough.</li>
        <li><b>Ready.</b> Every problem is fixed or knowingly accepted, with a signed record if anything is disputed later.</li>
      </ol>

      <h2>Who is involved</h2>
      <div className="grid four">
        <div className="panel"><h3>Client</h3><p className="small">Pays into the escrow. Can accept a risk knowingly, and approves any replacement contract.</p></div>
        <div className="panel"><h3>Lawyer</h3><p className="small">Approves what Claude extracted. Can require the developer to fix a problem.</p></div>
        <div className="panel"><h3>Developer</h3><p className="small">Wrote the smart contract. Fixes problems and proposes the corrected version.</p></div>
        <div className="panel"><h3>Chainlink</h3><p className="small">Independent checker. The only one that can confirm a fix.</p></div>
      </div>

      <p className="small muted" style={{ marginTop: '2rem' }}>
        LexDiff keeps evidence; it does not decide who is liable. A wallet signature proves control of a key, not someone&apos;s legal identity.
        Only fingerprints (hashes) are stored on the blockchain; the terms and notes stay off-chain.
      </p>
    </>
  )
}
