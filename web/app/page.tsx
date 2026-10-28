'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { type Agreement, type Finding, getEvidence, REGISTRY_ADDRESS, registry, shortAddr } from '@/lib/registry'
import type { EscrowTerms } from '@/lib/terms'

type Row = { id: bigint; agreement: Agreement; title: string; findings: Finding[] }

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
            const terms = await getEvidence<EscrowTerms>(agreement.termsHash, agreement.termsURI)
            return { id, agreement, title: terms?.title ?? 'Terms unavailable', findings: await registry.getFindings(id) }
          }),
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
        {rows?.map(({ id, agreement, title, findings }) => {
          const open = findings.filter((f) => f.status === 1 || f.status === 3).length
          const accepted = findings.filter((f) => f.status === 2).length
          const resolved = findings.filter((f) => f.status === 4).length
          return (
            <Link key={id.toString()} href={`/agreements/${id}`} className="panel row spread" style={{ color: 'inherit' }}>
              <div>
                <h3 style={{ margin: 0 }}>#{id.toString()} · {title}</h3>
                <span className="small muted mono">contract {shortAddr(agreement.target)}</span>
              </div>
              <div className="row">
                {agreement.supersededBy > BigInt(0) && <span className="badge tone-muted">amended by #{agreement.supersededBy.toString()}</span>}
                {findings.length === 0 && <span className="badge tone-muted">Awaiting CRE check</span>}
                {open > 0 && <span className="badge tone-bad">{open} open</span>}
                {accepted > 0 && <span className="badge tone-warn">{accepted} accepted risk</span>}
                {resolved > 0 && <span className="badge tone-ok">{resolved} resolved</span>}
              </div>
            </Link>
          )
        })}
      </div>

      <h2>Six questions, each with a signed or verified answer</h2>
      <ol className="steps">
        <li><b>What was agreed?</b> Claude drafts the terms with verbatim quotes. The reviewer and the client sign the reviewed terms, the roles and the verifier.</li>
        <li><b>Does the code match?</b> A Chainlink CRE workflow compares the terms with the verified source and on-chain state, deterministically.</li>
        <li><b>Who knew?</b> Findings are anchored on-chain by hash; parties sign <i>Acknowledge</i> on the exact evidence they saw.</li>
        <li><b>Who took the risk, and who fixes?</b> The client signs <i>Accepted risk</i>; the reviewer signs <i>Remediation required</i> for the developer.</li>
        <li><b>Is it fixed?</b> Only a report from the agreement&apos;s own verifier can mark a finding Resolved.</li>
        <li><b>Who disputes?</b> Any party can sign <i>Dispute</i>. History is never rewritten; amendments become new agreements.</li>
      </ol>
      <p className="small muted">
        Only hashes are stored on-chain. Terms, reports and notes live in the evidence store and are checked against those hashes.
        A wallet signature proves control of a key, not legal identity or binding consent.
      </p>
    </>
  )
}
