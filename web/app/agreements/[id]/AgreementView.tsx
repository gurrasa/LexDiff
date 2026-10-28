'use client'

import Link from 'next/link'
import { useParams } from 'next/navigation'
import { Fragment, useCallback, useEffect, useState } from 'react'
import { type Address, type Hex, isAddress } from 'viem'
import {
  type Agreement,
  type Check,
  connectWallet,
  DECISION_LABEL,
  DECISION_TYPES,
  type Decision,
  DecisionType,
  DOMAIN,
  EXPLORER,
  type Finding,
  fmtTime,
  getEvidence,
  KIND,
  noteValue,
  putEvidence,
  type ReportDocument,
  registry,
  same,
  STATUS,
  STATUS_TONE,
  shortAddr,
  writeRegistry,
  ZERO_BYTES32,
} from '@/lib/registry'
import type { EscrowTerms } from '@/lib/terms'

type Details = { clause: string; expected: string; actual: string }

type Data = {
  agreement: Agreement
  terms: EscrowTerms | null
  findings: Finding[]
  checks: Check[]
  reports: (ReportDocument | null)[]
  details: Record<string, Details>
  history: Address[]
  decisions: Record<string, Decision[]>
  notes: Record<string, string>
}

const ZERO = '0x0000000000000000000000000000000000000000'

export default function AgreementView() {
  const { id: idParam } = useParams<{ id: string }>()
  const id = BigInt(idParam)
  const [data, setData] = useState<Data | null>(null)
  const [account, setAccount] = useState<Address | null>(null)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [expanded, setExpanded] = useState<string | null>(null)
  const [note, setNote] = useState('')
  const [newTarget, setNewTarget] = useState('')

  const load = useCallback(async () => {
    const [agreement, findings, checks, history] = await Promise.all([
      registry.getAgreement(id),
      registry.getFindings(id),
      registry.getChecks(id),
      registry.getContractHistory(id),
    ])
    const [terms, reports] = await Promise.all([
      getEvidence<EscrowTerms>(agreement.termsHash, agreement.termsURI),
      Promise.all(checks.map((c) => getEvidence<ReportDocument>(c.reportHash))),
    ])
    // Details are only shown when the off-chain report hashes to what CRE anchored on-chain.
    const details: Record<string, Details> = {}
    for (const r of reports) for (const f of r?.findings ?? []) details[f.detailsHash] = f

    const decisions: Record<string, Decision[]> = {}
    await Promise.all(findings.map(async (f) => (decisions[f.key] = await registry.getDecisions(id, f.key))))
    const notes: Record<string, string> = {}
    const noteHashes = new Set(Object.values(decisions).flat().map((d) => d.noteHash).filter((h) => h !== ZERO_BYTES32))
    await Promise.all(
      [...noteHashes].map(async (h) => {
        const v = await getEvidence<{ note: string }>(h)
        if (v) notes[h] = v.note
      }),
    )
    setData({ agreement, terms, findings, checks, reports, details, history, decisions, notes })
  }, [id])

  useEffect(() => {
    load().catch((e) => setError(String(e?.shortMessage ?? e)))
  }, [load])

  const run = async (label: string, fn: () => Promise<void>) => {
    setBusy(label)
    setError('')
    try {
      await fn()
      await load()
    } catch (e) {
      const err = e as { shortMessage?: string; message?: string }
      setError(err.shortMessage ?? err.message ?? String(e))
    } finally {
      setBusy('')
    }
  }

  const connect = () => run('Connecting wallet', async () => setAccount((await connectWallet()).account))

  const decide = (f: Finding, decision: number) =>
    run(`Signing ${DECISION_LABEL[decision]}`, async () => {
      if (decision === DecisionType.Dispute && !note.trim()) throw new Error('A dispute needs a reason.')
      const { wallet, account } = await connectWallet()
      setAccount(account)
      const noteHash = note.trim() ? (await putEvidence(noteValue(note.trim()))).hash : ZERO_BYTES32
      const nonce = await registry.nonces(account)
      const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600)
      const signature = await wallet.signTypedData({
        account,
        domain: DOMAIN(),
        types: DECISION_TYPES,
        primaryType: 'Decision',
        message: { agreementId: id, findingKey: f.key, decision, evidenceHash: f.evidenceHash, noteHash, nonce, deadline },
      })
      setBusy('Recording signed decision on-chain')
      await writeRegistry('submitDecision', [id, f.key, decision, f.evidenceHash, noteHash, deadline, account, signature])
      setNote('')
      setExpanded(null)
    })

  if (error && !data) return <p className="error">{error}</p>
  if (!data) return <p className="muted">Loading agreement #{idParam} from Sepolia…</p>

  const { agreement: a, terms, findings, checks, reports, details, history, decisions, notes } = data
  const isClient = same(account ?? '', a.client)
  const isReviewer = same(account ?? '', a.reviewer)
  const isDeveloper = same(account ?? '', a.developer)
  const isParty = isClient || isReviewer || isDeveloper
  const roles = [isClient && 'client', isReviewer && 'reviewer', isDeveloper && 'developer'].filter(Boolean)
  const roleOf = (addr: string) =>
    [same(addr, a.client) && 'client', same(addr, a.reviewer) && 'reviewer', same(addr, a.developer) && 'developer']
      .filter(Boolean)
      .join('/') || 'signer'
  const count = (s: number) => findings.filter((f) => f.status === s).length
  const sorted = [...findings].sort((x, y) => (x.kind === 0 ? 1 : 0) - (y.kind === 0 ? 1 : 0) || x.firstCheck - y.firstCheck)
  const simulateCmd = `cd cre && cre workflow simulate lexdiff-workflow --target staging-settings --broadcast \\\n  --non-interactive --trigger-index 0 --http-payload '{"agreementId":${idParam}}'`
  const pending = a.pendingTarget !== ZERO
  const isMock = same(a.verifier.forwarder, '0x15fC6ae953E024d975e77382eEeC56A9101f9F88')

  return (
    <>
      <div className="row spread">
        <div>
          <span className="muted small">Agreement #{idParam}</span>
          <h1>{terms?.title ?? 'Agreement'}</h1>
        </div>
        {account ? (
          <span className="badge tone-info mono">{shortAddr(account)} · {roles.length ? roles.join(', ') : 'no role'}</span>
        ) : (
          <button onClick={connect}>Connect wallet</button>
        )}
      </div>
      {a.supersededBy > BigInt(0) && (
        <p className="notice">This agreement was amended by <Link href={`/agreements/${a.supersededBy}`}>agreement #{a.supersededBy.toString()}</Link>. Its history stays here unchanged.</p>
      )}
      {a.supersedes > BigInt(0) && (
        <p className="notice">Amends <Link href={`/agreements/${a.supersedes}`}>agreement #{a.supersedes.toString()}</Link>.</p>
      )}
      {!terms && <p className="error">Terms at {a.termsURI} are unavailable or do not match the registered hash.</p>}
      {error && <p className="error">{error}</p>}
      {busy && <p className="notice">{busy}…</p>}

      <div className="grid four" style={{ margin: '1rem 0' }}>
        <div className="panel"><div className="stat">{count(1)}</div><span className="muted small">Open</span></div>
        <div className="panel"><div className="stat">{count(3)}</div><span className="muted small">Remediation required</span></div>
        <div className="panel"><div className="stat">{count(2)}</div><span className="muted small">Accepted risk</span></div>
        <div className="panel"><div className="stat">{count(4)}</div><span className="muted small">Resolved by CRE</span></div>
      </div>

      <h2>Findings</h2>
      {findings.length === 0 ? (
        <div className="panel">
          <p>No CRE check recorded yet. Run the workflow:</p>
          <pre>{simulateCmd}</pre>
        </div>
      ) : (
        <div className="panel table-wrap" style={{ padding: 0 }}>
          <table>
            <thead>
              <tr>
                <th>Finding</th>
                <th>Agreement says</th>
                <th>Code does</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {sorted.map((f) => {
                const kind = KIND[f.kind]
                const ds = decisions[f.key] ?? []
                const d = f.detailsHash === ZERO_BYTES32 ? null : details[f.detailsHash]
                const disputed = f.disputedInCheck !== 0 && f.disputedInCheck === f.lastCheck
                const acks = ds.filter((x) => x.decision === DecisionType.Acknowledge && x.atCheck === f.lastCheck)
                const actionable = f.kind !== 0 || f.status === 4
                const canAccept = isClient && f.kind !== 0 && (f.status === 1 || f.status === 3)
                const canAssign = isReviewer && f.kind !== 0 && (f.status === 1 || f.status === 2)
                const open = expanded === f.key
                return (
                  <Fragment key={f.key}>
                    <tr>
                      <td>
                        <span className={`badge tone-${kind.tone}`}>{kind.icon} {kind.label}</span>
                        <div style={{ marginTop: 4 }}><b>{d?.clause ?? (f.detailsHash === ZERO_BYTES32 ? 'Removed from code' : 'Details unavailable')}</b></div>
                      </td>
                      <td className="small">{d?.expected ?? '—'}</td>
                      <td className="small">{d?.actual ?? (f.detailsHash === ZERO_BYTES32 ? 'no longer present in code' : <span className="muted">hash <code>{f.detailsHash.slice(0, 10)}…</code></span>)}</td>
                      <td>
                        <div className="row" style={{ gap: 4 }}>
                          <span className={`badge tone-${STATUS_TONE[f.status]}`}>{STATUS[f.status]}</span>
                          {disputed && <span className="badge tone-warn">⚖️ Disputed</span>}
                        </div>
                        {f.status === 3 && <div className="small muted">assigned to {shortAddr(f.assignee)}</div>}
                        {f.status === 4 && <div className="small muted">verified in check #{f.resolvedInCheck}</div>}
                        {acks.length > 0 && <div className="small muted">acknowledged by {acks.map((x) => roleOf(x.signer)).join(', ')}</div>}
                      </td>
                      <td>
                        <button className="ghost small" onClick={() => { setExpanded(open ? null : f.key); setNote('') }}>
                          {open ? 'Close' : ds.length ? `Trail (${ds.length})` : 'Details'}
                        </button>
                      </td>
                    </tr>
                    {open && (
                      <tr>
                        <td colSpan={5} style={{ background: 'var(--bg)' }}>
                          <div className="grid two">
                            <div className="small stack">
                              <div>Evidence hash <code>{f.evidenceHash}</code></div>
                              <div>Details hash <code>{f.detailsHash}</code> {d && <span className="badge tone-ok">✓ off-chain details match</span>}</div>
                              <div>First seen in check #{f.firstCheck}, last checked in #{f.lastCheck}{f.openedAt ? `, opened ${fmtTime(f.openedAt)}` : ''}</div>
                              <h3>Decision trail</h3>
                              {ds.length === 0 && <p className="muted">No signed decisions.</p>}
                              <ul className="timeline">
                                {ds.map((x, i) => (
                                  <li key={i}>
                                    <b>{DECISION_LABEL[x.decision]}</b> by <span className="mono">{shortAddr(x.signer)}</span> ({roleOf(x.signer)}) · check #{x.atCheck} · {fmtTime(x.timestamp)}
                                    {x.noteHash !== ZERO_BYTES32 && <div>“{notes[x.noteHash] ?? `note ${x.noteHash.slice(0, 10)}… unavailable`}”</div>}
                                    <div className="muted">EIP-712 sig <code>{x.signature.slice(0, 18)}…</code> over evidence <code>{x.evidenceHash.slice(0, 10)}…</code></div>
                                  </li>
                                ))}
                                {f.status === 4 && <li><b>Resolved</b> by CRE in check #{f.resolvedInCheck} · {fmtTime(f.resolvedAt)}</li>}
                              </ul>
                            </div>
                            <div className="stack">
                              {isParty && actionable ? (
                                <>
                                  <label>Note (stored off-chain, its hash is signed)</label>
                                  <textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Reason, clause reference… (required to dispute)" />
                                  <div className="row">
                                    {canAccept && <button onClick={() => decide(f, DecisionType.AcceptRisk)} disabled={!!busy}>Accept risk</button>}
                                    {canAssign && <button onClick={() => decide(f, DecisionType.RequireRemediation)} disabled={!!busy}>Require remediation</button>}
                                    <button className="ghost" onClick={() => decide(f, DecisionType.Acknowledge)} disabled={!!busy}>Acknowledge</button>
                                    <button className="ghost" onClick={() => decide(f, DecisionType.Dispute)} disabled={!!busy || !note.trim()}>Dispute</button>
                                  </div>
                                  <p className="small muted">
                                    Acknowledge records that you saw this exact evidence. Dispute records that you contest it; the finding and its history stay as they are.
                                  </p>
                                </>
                              ) : (
                                <p className="small muted">
                                  {f.kind === 0 && f.status !== 4
                                    ? 'Code and agreement agree. Nothing to decide.'
                                    : 'Connect a party wallet (client, reviewer or developer) to sign a decision.'}
                                </p>
                              )}
                              <p className="small muted">No signed decision can resolve a finding. Only a report from this agreement&apos;s verifier can.</p>
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      <div className="grid two" style={{ marginTop: '1rem' }}>
        <section>
          <h2>CRE checks</h2>
          {checks.length === 0 && <p className="muted">None yet.</p>}
          <ul className="timeline">
            {checks.map((c, i) => ({ c, i })).reverse().map(({ c, i }) => (
              <li key={i}>
                <b>Check #{i + 1}</b> · {fmtTime(c.timestamp)}
                <div className="small">
                  contract <a className="mono" href={`${EXPLORER}/address/${c.target}#code`} target="_blank">{shortAddr(c.target)}</a> ·{' '}
                  {c.findingCount} terms compared · {c.nonMatchCount} not matching
                </div>
                <div className="small muted">
                  source <code>{c.codeHash.slice(0, 12)}…</code> · report <code>{c.reportHash.slice(0, 12)}…</code>{' '}
                  {reports[i] ? <span className="badge tone-ok">✓ report matches</span> : <span className="badge tone-warn">report unavailable</span>}
                </div>
                {c.workflowOwner !== ZERO && <div className="small muted">workflow owner <code>{shortAddr(c.workflowOwner)}</code></div>}
              </li>
            ))}
          </ul>
        </section>

        <section>
          <h2>Record</h2>
          <div className="panel small stack">
            <div>Client <code>{a.client}</code></div>
            <div>Reviewer <code>{a.reviewer}</code> <span className="muted">(signed the reviewed terms)</span></div>
            <div>Developer <code>{a.developer}</code></div>
            <div>
              Terms <a href={a.termsURI} target="_blank">{a.termsURI.length > 60 ? `${a.termsURI.slice(0, 60)}…` : a.termsURI}</a>
              <div className="muted">hash <code>{a.termsHash}</code></div>
            </div>
            <div>
              Verifier <code>{shortAddr(a.verifier.forwarder)}</code>{' '}
              {isMock ? <span className="badge tone-warn">CRE simulation forwarder</span> : <span className="badge tone-info">KeystoneForwarder</span>}
              <div className="muted">
                workflow owner {a.verifier.workflowOwner === ZERO ? 'not pinned' : <code>{shortAddr(a.verifier.workflowOwner)}</code>} · workflow ID{' '}
                {a.verifier.workflowId === ZERO_BYTES32 ? 'not pinned' : <code>{a.verifier.workflowId.slice(0, 12)}…</code>} · fixed at signing
              </div>
            </div>
            <div>
              Contract history
              <ol style={{ margin: '0.25rem 0 0' }}>
                {history.map((h, i) => (
                  <li key={i}>
                    <a className="mono" href={`${EXPLORER}/address/${h}#code`} target="_blank">{h}</a>
                    {i === history.length - 1 && <span className="badge tone-info" style={{ marginLeft: 6 }}>current</span>}
                  </li>
                ))}
              </ol>
              {pending && <div>Proposed: <code>{a.pendingTarget}</code> <span className="badge tone-warn">awaiting client</span></div>}
            </div>
          </div>

          {isParty && (
            <div className="panel stack" style={{ marginTop: '1rem' }}>
              <h3 style={{ margin: 0 }}>Redeploy &amp; re-check</h3>
              {(isDeveloper || isReviewer) && (
                <>
                  <label>Propose new contract address</label>
                  <input className="mono" value={newTarget} onChange={(e) => setNewTarget(e.target.value)} placeholder="0x…" />
                  <button
                    disabled={!!busy || !isAddress(newTarget)}
                    onClick={() => run('Proposing contract', async () => void (await writeRegistry('proposeContract', [id, newTarget])))}
                  >
                    Propose redeployed contract
                  </button>
                </>
              )}
              {isClient && pending && (
                <button onClick={() => run('Accepting contract', async () => void (await writeRegistry('acceptContract', [id, a.pendingTarget])))} disabled={!!busy}>
                  Accept {shortAddr(a.pendingTarget)} as the enforcing contract
                </button>
              )}
              <button className="ghost" disabled={!!busy} onClick={() => run('Requesting check', async () => void (await writeRegistry('requestCheck', [id])))}>
                Request CRE check
              </button>
              <p className="small muted">The client holds the funds, so only the client can accept a new contract. Accepting emits <code>CheckRequested</code>. To run the workflow locally:</p>
              <pre>{simulateCmd}</pre>
            </div>
          )}
        </section>
      </div>
    </>
  )
}
