'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { type Agreement, type Finding, REGISTRY_ADDRESS, registry, shortAddr } from '@/lib/registry'

type Row = { id: bigint; agreement: Agreement; findings: Finding[] }

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
          ids.map(async (id) => ({ id, agreement: await registry.getAgreement(id), findings: await registry.getFindings(id) })),
        ),
      )
    })().catch((e) => setError(String(e?.shortMessage ?? e)))
  }, [])

  return (
    <>
      <section style={{ margin: '1.5rem 0 2rem' }}>
        <h1>Does the code do what the parties signed?</h1>
        <p className="lede">
          LexDiff compares a legal agreement with the smart contract that enforces it, records every mismatch on-chain,
          and tracks who is responsible for each one until a Chainlink CRE check confirms it is resolved.
        </p>
        <div className="row small muted">
          <span className="badge tone-ok">✅ Match</span>
          <span className="badge tone-warn">⚠️ Mismatch</span>
          <span className="badge tone-bad">❌ Missing</span>
          <span className="badge tone-bad">🚩 Hidden power</span>
        </div>
      </section>

      {!REGISTRY_ADDRESS && (
        <p className="notice">
          Set <code>NEXT_PUBLIC_REGISTRY_ADDRESS</code> in <code>web/.env.local</code> to the deployed LexDiffRegistry.
        </p>
      )}
      {error && <p className="error">{error}</p>}

      <div className="row spread">
        <h2 style={{ margin: 0 }}>Agreements</h2>
        <Link href="/new" className="button">Register an agreement</Link>
      </div>

      <div className="stack" style={{ marginTop: '1rem' }}>
        {rows === null && REGISTRY_ADDRESS && !error && <p className="muted">Loading from Sepolia…</p>}
        {rows?.length === 0 && <p className="muted">No agreements yet.</p>}
        {rows?.map(({ id, agreement, findings }) => {
          const open = findings.filter((f) => f.status === 1 || f.status === 3).length
          const accepted = findings.filter((f) => f.status === 2).length
          const resolved = findings.filter((f) => f.status === 4).length
          return (
            <Link key={id.toString()} href={`/agreements/${id}`} className="panel row spread" style={{ color: 'inherit' }}>
              <div>
                <h3 style={{ margin: 0 }}>#{id.toString()} · {agreement.title}</h3>
                <span className="small muted mono">contract {shortAddr(agreement.target)}</span>
              </div>
              <div className="row">
                {findings.length === 0 && <span className="badge tone-muted">Awaiting CRE check</span>}
                {open > 0 && <span className="badge tone-bad">{open} open</span>}
                {accepted > 0 && <span className="badge tone-warn">{accepted} accepted risk</span>}
                {resolved > 0 && <span className="badge tone-ok">{resolved} resolved</span>}
              </div>
            </Link>
          )
        })}
      </div>

      <h2>How it works</h2>
      <ol className="steps">
        <li><b>The agreement is read.</b> Claude extracts parties, amounts, deadlines, payout and refund rules and admin powers. Counsel reviews the draft; its hash is registered on-chain.</li>
        <li><b>A Chainlink CRE workflow compares.</b> It reads the contract&apos;s on-chain values and its verified source from Etherscan, and deterministically compares them with the terms.</li>
        <li><b>Findings are recorded.</b> Each one is written to the registry with an evidence hash and status Open.</li>
        <li><b>Accountability.</b> The client can sign <i>Accepted risk</i>; the reviewer can assign <i>Remediation required</i> to the developer. Every decision is EIP-712 signed and stored on-chain.</li>
        <li><b>CRE confirms the fix.</b> After redeployment the workflow re-runs. Only a CRE report can mark a finding Resolved.</li>
      </ol>
    </>
  )
}
