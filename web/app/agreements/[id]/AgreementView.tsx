'use client'

import Link from 'next/link'
import { useParams } from 'next/navigation'
<<<<<<< HEAD
import { useCallback, useEffect, useState } from 'react'
import { type Address, type Hex, isAddress } from 'viem'
import { KIND_PLAIN, ROLES, type Role, rolesOf, roleNames, STATUS_PLAIN, STEPS, stageOf } from '@/lib/plain'
=======
import { Fragment, useCallback, useEffect, useState } from 'react'
import { type Address, isAddress, keccak256, toBytes, zeroHash } from 'viem'
import { sepolia } from 'viem/chains'
>>>>>>> df31607 (Align LexDiff with evidence-first design)
import {
  type Agreement,
  type AgreementEvent,
  type Check,
  connectWallet,
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
  STATUS_TONE,
  shortAddr,
  writeRegistry,
  ZERO_BYTES32,
} from '@/lib/registry'
<<<<<<< HEAD
import type { EscrowTerms } from '@/lib/terms'

type Details = { clause: string; expected: string; actual: string }
type Past = Details & { kind: number; check: number }
=======
import { canonicalize } from '@/lib/terms'

type FindingDetail = { key: `0x${string}`; clause: string; expected: string; actual: string }
>>>>>>> df31607 (Align LexDiff with evidence-first design)

type Data = {
  agreement: Agreement
  terms: EscrowTerms | null
  findings: Finding[]
  checks: Check[]
  reports: (ReportDocument | null)[]
  details: Record<string, Details>
  past: Record<string, Past[]>
  history: Address[]
  decisions: Record<string, Decision[]>
<<<<<<< HEAD
  notes: Record<string, string>
=======
  pendingTarget: Address
  details: Record<string, FindingDetail>
  events: AgreementEvent[]
>>>>>>> df31607 (Align LexDiff with evidence-first design)
}

const ZERO = '0x0000000000000000000000000000000000000000'

const DECISION_VERB: Record<number, string> = {
  [DecisionType.AcceptRisk]: 'accepted the risk',
  [DecisionType.RequireRemediation]: 'required the developer to fix',
  [DecisionType.Acknowledge]: 'confirmed they have seen',
  [DecisionType.Dispute]: 'disputed',
}

export default function AgreementView() {
  const { id: idParam } = useParams<{ id: string }>()
  const id = BigInt(idParam)
  const [data, setData] = useState<Data | null>(null)
  const [account, setAccount] = useState<Address | null>(null)
  const [actingAs, setActingAs] = useState<Role | null>(null)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [notes, setNotes] = useState<Record<string, string>>({})
  const [newTarget, setNewTarget] = useState('')
  const [showEvidence, setShowEvidence] = useState(false)
  const [log, setLog] = useState('')

  const load = useCallback(async () => {
    const [agreement, findings, checks, history, pendingTarget, events] = await Promise.all([
      registry.getAgreement(id),
      registry.getFindings(id),
      registry.getChecks(id),
      registry.getContractHistory(id),
      registry.pendingTarget(id),
      registry.events(id),
    ])
    const [terms, reports] = await Promise.all([
      getEvidence<EscrowTerms>(agreement.termsHash, agreement.termsURI),
      Promise.all(checks.map((c) => getEvidence<ReportDocument>(c.reportHash))),
    ])
    // Details are only shown when the off-chain report hashes to what Chainlink anchored on-chain.
    const details: Record<string, Details> = {}
    const past: Record<string, Past[]> = {}
    reports.forEach((r, i) => {
      for (const f of r?.findings ?? []) {
        details[f.detailsHash] = f
        ;(past[f.key] ??= []).push({ ...f, check: i + 1 })
      }
    })

    const decisions: Record<string, Decision[]> = {}
    await Promise.all(findings.map(async (f) => (decisions[f.key] = await registry.getDecisions(id, f.key))))
<<<<<<< HEAD
    const noteText: Record<string, string> = {}
    const hashes = new Set(Object.values(decisions).flat().map((d) => d.noteHash).filter((h) => h !== ZERO_BYTES32))
    await Promise.all(
      [...hashes].map(async (h) => {
        const v = await getEvidence<{ note: string }>(h)
        if (v) noteText[h] = v.note
      }),
    )
    setData({ agreement, terms, findings, checks, reports, details, past, history, decisions, notes: noteText })
=======
    const details: Record<string, FindingDetail> = {}
    for (const check of [...checks].reverse()) {
      const response = await fetch(`/api/evidence/${check.reportHash}`)
      if (response.ok) {
        const report = await response.json() as { findings?: FindingDetail[] }
        if (keccak256(toBytes(canonicalize(report))) !== check.reportHash) throw new Error('Evidence report hash mismatch')
        for (const finding of report.findings ?? []) details[finding.key] ??= finding
      }
    }
    setData({ agreement, findings, checks, history, decisions, pendingTarget, details, events })
>>>>>>> df31607 (Align LexDiff with evidence-first design)
  }, [id])

  useEffect(() => {
    load().catch((e) => setError(String(e?.shortMessage ?? e)))
    fetch('/api/demo')
      .then((r) => r.json())
      .then((d) => d.escrowV2 && setNewTarget((t) => t || d.escrowV2))
      .catch(() => {})
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

  const connect = () =>
    run('Connecting wallet', async () => {
      const { account } = await connectWallet()
      setAccount(account)
      if (data) setActingAs(rolesOf(data.agreement, account)[0] ?? null)
    })

  const decide = (f: Finding, decision: number) =>
<<<<<<< HEAD
    run('Waiting for your signature', async () => {
      const note = (notes[f.key] ?? '').trim()
      if (decision === DecisionType.Dispute && !note) throw new Error('Write why you disagree before disputing.')
=======
    run(`Signing ${DECISION_LABEL[decision]}`, async () => {
>>>>>>> df31607 (Align LexDiff with evidence-first design)
      const { wallet, account } = await connectWallet()
      const noteHash = note ? (await putEvidence(noteValue(note))).hash : ZERO_BYTES32
      const nonce = await registry.nonces(account)
      const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600)
      if (decision === DecisionType.Dispute && !note.trim()) throw new Error('A dispute requires a reason')
      const noteHash = note ? keccak256(toBytes(note)) : zeroHash
      const signature = await wallet.signTypedData({
        account,
        domain: DOMAIN(),
        types: DECISION_TYPES,
        primaryType: 'Decision',
<<<<<<< HEAD
        message: { agreementId: id, findingKey: f.key, decision, evidenceHash: f.evidenceHash, noteHash, nonce, deadline },
      })
      setBusy('Recording your signed decision on Sepolia')
      await writeRegistry('submitDecision', [id, f.key, decision, f.evidenceHash, noteHash, deadline, account, signature])
      setNotes((n) => ({ ...n, [f.key]: '' }))
    })

  const runCheck = () =>
    run('Chainlink is checking the contract (30–90 seconds)', async () => {
      setLog('')
      const res = await fetch('/api/run-check', { method: 'POST', body: JSON.stringify({ agreementId: idParam }) })
      if (!res.ok) throw new Error((await res.json()).error)
      const reader = res.body!.getReader()
      const decoder = new TextDecoder()
      let all = ''
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        all += decoder.decode(value)
        setLog(all.replace(/\n__EXIT__\d+\n?$/, ''))
      }
      const code = /__EXIT__(\d+)/.exec(all)?.[1]
      if (code !== '0') throw new Error('The Chainlink check failed. See the log below.')
=======
        message: {
          agreementId: id,
          findingKey: f.key,
          decision,
          evidenceHash: f.evidenceHash,
          noteHash,
          nonce,
          deadline,
        },
      })
      setBusy('Recording signed decision on-chain')
      if (note) {
        const stored = await fetch('/api/notes', { method: 'POST', body: JSON.stringify({ note }) })
        const noteRecord = await stored.json()
        if (!stored.ok || noteRecord.hash !== noteHash) throw new Error(noteRecord.error || 'Note hash mismatch')
      }
      await writeRegistry('submitDecision', [id, f.key, decision, f.evidenceHash, noteHash, deadline, account, signature])
      setNote('')
      setExpanded(null)
>>>>>>> df31607 (Align LexDiff with evidence-first design)
    })

  if (error && !data) return <p className="error">{error}</p>
  if (!data) return <p className="muted">Loading agreement #{idParam} from Sepolia…</p>

<<<<<<< HEAD
  const { agreement: a, terms, findings, checks, details, past, history, decisions, notes: noteText } = data
  const myRoles = rolesOf(a, account)
  const role = actingAs && myRoles.includes(actingAs) ? actingAs : (myRoles[0] ?? null)
  const stage = stageOf(a, findings, checks)
  const issues = findings.filter((f) => f.kind !== 0 || f.status === 4).sort((x, y) => x.status - y.status)
  const matches = findings.filter((f) => f.kind === 0 && f.status !== 4)
  const pending = a.pendingTarget !== ZERO
  const isMock = same(a.verifier.forwarder, '0x15fC6ae953E024d975e77382eEeC56A9101f9F88')
=======
  const { agreement: a, findings, checks, history, decisions, pendingTarget, details, events } = data
  const isClient = same(account ?? '', a.client)
  const isReviewer = same(account ?? '', a.reviewer)
  const isDeveloper = same(account ?? '', a.developer)
  const roles = [isClient && 'client', isReviewer && 'reviewer', isDeveloper && 'developer'].filter(Boolean)
  const count = (s: number) => findings.filter((f) => f.status === s).length
  const sorted = [...findings].sort((x, y) => (x.kind === 0 ? 1 : 0) - (y.kind === 0 ? 1 : 0) || x.firstCheck - y.firstCheck)
>>>>>>> df31607 (Align LexDiff with evidence-first design)
  const simulateCmd = `cd cre && cre workflow simulate lexdiff-workflow --target staging-settings --broadcast \\\n  --non-interactive --trigger-index 0 --http-payload '{"agreementId":${idParam}}'`
  const clauseOf = (f: Finding) => (f.detailsHash === ZERO_BYTES32 ? past[f.key]?.at(-1)?.clause : details[f.detailsHash]?.clause) ?? 'Unknown term'

  // Plain-language history of everything that happened.
  const events: { t: bigint; text: string; note?: string }[] = [
    { t: a.createdAt, text: 'Agreement registered. The reviewer and the client signed the terms.' },
    ...checks.map((c, i) => ({
      t: c.timestamp,
      text: `Chainlink check #${i + 1} of contract ${shortAddr(c.target)}: ${c.nonMatchCount === 0 ? 'no issues' : `${c.nonMatchCount} issue${c.nonMatchCount > 1 ? 's' : ''}`}.`,
    })),
    ...findings.flatMap((f) =>
      (decisions[f.key] ?? []).map((d) => ({
        t: d.timestamp,
        text: `The ${roleNames(a, d.signer)} ${DECISION_VERB[d.decision]}: ${clauseOf(f)}.`,
        note: d.noteHash !== ZERO_BYTES32 ? noteText[d.noteHash] : undefined,
      })),
    ),
    ...findings.filter((f) => f.status === 4).map((f) => ({ t: f.resolvedAt, text: `Chainlink confirmed the fix: ${clauseOf(f)}.` })),
  ].sort((x, y) => Number(x.t - y.t))

  const nextAction = () => {
    if (stage.waitingFor === 'chainlink') {
      return (
        <div className="stack">
          <div className="row">
            <button onClick={runCheck} disabled={!!busy}>Run the Chainlink check</button>
            <span className="small muted">Runs the real CRE workflow locally (simulation).</span>
          </div>
          <details>
            <summary>Or run it in a terminal</summary>
            <pre>{simulateCmd}</pre>
          </details>
        </div>
      )
    }
    if (stage.waitingFor === 'developer' && role === 'developer') {
      return (
        <div className="stack">
          <label>Address of the corrected contract</label>
          <input className="mono" value={newTarget} onChange={(e) => setNewTarget(e.target.value)} placeholder="0x…" />
          <button
            disabled={!!busy || !isAddress(newTarget)}
            onClick={() => run('Proposing the corrected contract', async () => void (await writeRegistry('proposeContract', [id, newTarget])))}
          >
            Propose this contract
          </button>
        </div>
      )
    }
    if (stage.waitingFor === 'client' && pending && role === 'client') {
      return (
        <button onClick={() => run('Approving the new contract', async () => void (await writeRegistry('acceptContract', [id, a.pendingTarget])))} disabled={!!busy}>
          Approve {shortAddr(a.pendingTarget)} as the contract that holds the money
        </button>
      )
    }
    if (stage.waitingFor === 'reviewer') {
      return <a href="#issues" className="button ghost">Go to the issues ↓</a>
    }
    if (stage.waitingFor && stage.waitingFor !== role) {
      return <p className="small">Connect the {ROLES[stage.waitingFor as Role].label.toLowerCase()}&apos;s wallet to continue.</p>
    }
    return null
  }

  const downloadRecord = () => {
    const record = {
      schema: 'lexdiff/case-record@1',
      exportedAt: new Date().toISOString(),
      chainId: sepolia.id,
      registry: REGISTRY_ADDRESS,
      agreementId: id,
      agreement: a,
      contractHistory: history,
      checks,
      findings,
      decisions,
      events: events.map((event) => ({ ...event, explorerUrl: `${EXPLORER}/tx/${event.transactionHash}` })),
    }
    const json = JSON.stringify(record, (_key, value) => typeof value === 'bigint' ? value.toString() : value, 2)
    const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }))
    const link = document.createElement('a')
    link.href = url
    link.download = `lexdiff-agreement-${idParam}-record.json`
    link.click()
    URL.revokeObjectURL(url)
  }

  return (
    <>
      {/* ---- Header ---- */}
      <div className="row spread">
        <div>
          <span className="muted small">Agreement #{idParam}</span>
          <h1 style={{ marginBottom: 4 }}>{terms?.title ?? 'Agreement'}</h1>
          {terms && (
            <p className="muted" style={{ margin: 0 }}>
              {terms.parties.client.name} pays <b>{terms.payment.amount} {terms.payment.tokenSymbol}</b> into an escrow contract.{' '}
              {terms.parties.freelancer.name} delivers within <b>{terms.deadlines.deliveryPeriodDays} days</b>.
            </p>
          )}
        </div>
<<<<<<< HEAD
        <div className="stack" style={{ textAlign: 'right' }}>
=======
        <div className="row">
          <button className="ghost" onClick={downloadRecord}>Export case record</button>
>>>>>>> df31607 (Align LexDiff with evidence-first design)
          {account ? (
            myRoles.length > 1 ? (
              <div>
                <div className="small muted">Act as</div>
                <div className="segmented">
                  {myRoles.map((r) => (
                    <button key={r} className={r === role ? 'on' : ''} onClick={() => setActingAs(r)}>{ROLES[r].label}</button>
                  ))}
                </div>
              </div>
            ) : (
              <span className="badge tone-info">{role ? `You are the ${ROLES[role].label.toLowerCase()}` : `${shortAddr(account)} · not a party`}</span>
            )
          ) : (
            <button onClick={connect}>Connect wallet</button>
          )}
          {role && <div className="small muted" style={{ maxWidth: 300 }}>{ROLES[role].can}</div>}
        </div>
      </div>

      {a.supersededBy > BigInt(0) && (
        <p className="notice">This agreement was amended by <Link href={`/agreements/${a.supersededBy}`}>agreement #{a.supersededBy.toString()}</Link>. Its history stays here unchanged.</p>
      )}
      {a.supersedes > BigInt(0) && <p className="notice">Amends <Link href={`/agreements/${a.supersedes}`}>agreement #{a.supersedes.toString()}</Link>.</p>}
      {!terms && <p className="error">The terms are unavailable or do not match the registered fingerprint.</p>}

<<<<<<< HEAD
      {/* ---- Journey ---- */}
      <ol className="stepper">
        {STEPS.map((s, i) => (
          <li key={s} className={i < stage.step ? 'done' : i === stage.step ? 'now' : ''}>{s}</li>
        ))}
      </ol>

      <section className={`next${stage.waitingFor === null ? ' done' : ''}`}>
        <span className="who">
          {stage.waitingFor === null
            ? 'Done'
            : stage.waitingFor === 'chainlink'
              ? 'Next: Chainlink'
              : `Next: the ${ROLES[stage.waitingFor].label.toLowerCase()}${stage.waitingFor === role ? ' (you)' : ''}`}
        </span>
        <h2>{stage.title}</h2>
        <p style={{ margin: 0 }}>{stage.detail}</p>
        {nextAction()}
      </section>

      {error && <p className="error" style={{ marginTop: '1rem' }}>{error}</p>}
      {busy && <p className="notice" style={{ marginTop: '1rem' }}>{busy}…</p>}
      {log && (
        <details open={!!busy} style={{ marginTop: '0.75rem' }}>
          <summary>Chainlink CRE log</summary>
          <pre className="log">{log}</pre>
        </details>
=======
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
                const detail = details[f.key]
                const canAccept = isClient && f.kind !== 0 && (f.status === 1 || f.status === 3)
                const canAssign = isReviewer && f.kind !== 0 && (f.status === 1 || f.status === 2)
                const canRecord = (isClient || isReviewer || isDeveloper) && f.kind !== 0 && f.status !== 4
                const open = expanded === f.key
                return (
                  <Fragment key={f.key}>
                    <tr>
                      <td>
                        <span className={`badge tone-${kind.tone}`}>{kind.icon} {kind.label}</span>
                        <div style={{ marginTop: 4 }}><b>{detail?.clause ?? `Finding ${f.key.slice(0, 10)}…`}</b></div>
                      </td>
                      <td className="small">{detail?.expected ?? 'See evidence report'}</td>
                      <td className="small">{detail?.actual ?? 'See evidence report'}</td>
                      <td>
                        <span className={`badge tone-${STATUS_TONE[f.status]}`}>{STATUS[f.status]}</span>
                        {f.status === 3 && <div className="small muted">assigned to {shortAddr(f.assignee)}</div>}
                        {f.status === 4 && <div className="small muted">verified in check #{f.resolvedInCheck}</div>}
                      </td>
                      <td>
                        <button className="ghost small" onClick={() => setExpanded(open ? null : f.key)}>
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
                              <div>First seen in check #{f.firstCheck}, last checked in #{f.lastCheck}{f.openedAt ? `, opened ${fmtTime(f.openedAt)}` : ''}</div>
                              <h3>Decision trail</h3>
                              {ds.length === 0 && <p className="muted">No signed decisions.</p>}
                              <ul className="timeline">
                                {ds.map((d, i) => (
                                  <li key={i}>
                                    <b>{DECISION_LABEL[d.decision]}</b> by{' '}
                                    <span className="mono">{shortAddr(d.signer)}</span>{' '}
                                    ({same(d.signer, a.client) ? 'client' : same(d.signer, a.reviewer) ? 'reviewer' : 'signer'}) ·{' '}
                                    {fmtTime(d.timestamp)}
                                    {d.noteHash !== zeroHash && <div><a href={`/api/notes/${d.noteHash}`} target="_blank">View signed note</a></div>}
                                    <div className="muted">EIP-712 sig <code>{d.signature.slice(0, 18)}…</code> over evidence <code>{d.evidenceHash.slice(0, 10)}…</code></div>
                                  </li>
                                ))}
                                {f.status === 4 && <li><b>Resolved</b> — CRE confirmed in check #{f.resolvedInCheck} · {fmtTime(f.resolvedAt)}</li>}
                              </ul>
                            </div>
                            <div className="stack">
                              {canRecord ? (
                                <>
                                  <label>Note (signed together with the decision)</label>
                                  <textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Reason, clause reference…" />
                                  <div className="row">
                                    <button className="ghost" onClick={() => decide(f, DecisionType.Acknowledge)} disabled={!!busy}>Acknowledge</button>
                                    {canAccept && (
                                      <button onClick={() => decide(f, DecisionType.AcceptRisk)} disabled={!!busy}>Sign: Accepted risk</button>
                                    )}
                                    {canAssign && (
                                      <button onClick={() => decide(f, DecisionType.RequireRemediation)} disabled={!!busy}>Sign: Remediation required</button>
                                    )}
                                    <button className="ghost" onClick={() => decide(f, DecisionType.Dispute)} disabled={!!busy}>Dispute</button>
                                  </div>
                                </>
                              ) : (
                                <p className="small muted">
                                  {f.kind === 0
                                    ? 'Code and agreement agree. Nothing to decide.'
                                    : f.status === 4
                                      ? 'Resolved. Only a new CRE check can reopen it.'
                                      : 'The client can accept this risk; the reviewer can require remediation. Connect the matching wallet.'}
                                </p>
                              )}
                              <p className="small muted">Nobody can mark a finding Resolved. Only a CRE check that no longer finds the mismatch can.</p>
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
>>>>>>> df31607 (Align LexDiff with evidence-first design)
      )}

      {/* ---- Issues ---- */}
      <div className="row spread" id="issues" style={{ marginTop: '2rem' }}>
        <h2 style={{ margin: 0 }}>What Chainlink found</h2>
        <label className="toggle">
          <input type="checkbox" checked={showEvidence} onChange={(e) => setShowEvidence(e.target.checked)} /> Show technical evidence
        </label>
      </div>
      {checks.length === 0 && <p className="muted">Nothing yet. The contract has not been checked.</p>}
      {checks.length > 0 && issues.length === 0 && <p className="notice">No issues: the contract matches every checked term.</p>}

      <div className="stack" style={{ marginTop: '1rem' }}>
        {issues.map((f) => {
          const d = f.detailsHash === ZERO_BYTES32 ? null : details[f.detailsHash]
          const before = (past[f.key] ?? []).filter((p) => p.kind !== 0).at(-1)
          const ds = decisions[f.key] ?? []
          const disputed = f.disputedInCheck !== 0 && f.disputedInCheck === f.lastCheck
          const tone = f.status === 4 ? 'ok' : KIND[f.kind].tone
          const ackedByMe = ds.some((x) => x.decision === DecisionType.Acknowledge && x.atCheck === f.lastCheck && same(x.signer, account ?? ''))
          const canAccept = role === 'client' && (f.status === 1 || f.status === 3)
          const canAssign = role === 'reviewer' && (f.status === 1 || f.status === 2)
          const note = notes[f.key] ?? ''
          return (
            <article key={f.key} className={`finding tone-${tone}`}>
              <div className="row spread">
                <h3 style={{ margin: 0 }}>{f.status === 4 ? '✅' : KIND[f.kind].icon} {clauseOf(f)}</h3>
                <div className="row" style={{ gap: 6 }}>
                  <span className={`badge tone-${STATUS_TONE[f.status]}`}>{STATUS_PLAIN[f.status]}</span>
                  {disputed && <span className="badge tone-warn">⚖️ Disputed</span>}
                </div>
<<<<<<< HEAD
              </div>
              <div className="small muted">{f.status === 4 ? 'Was: ' + KIND_PLAIN[before?.kind ?? f.kind].toLowerCase() : KIND_PLAIN[f.kind]}</div>

              <div className="says">
                <div><span>The agreement says</span>{d?.expected ?? before?.expected ?? '—'}</div>
                {f.status === 4 && before ? (
                  <div><span>The code did → now does</span>{before.actual} → {d?.actual ?? 'removed'}</div>
                ) : (
                  <div><span>The code does</span>{d?.actual ?? (f.detailsHash === ZERO_BYTES32 ? 'No longer in the code' : '—')}</div>
                )}
              </div>

              {ds.length > 0 && (
                <ul className="small" style={{ margin: 0, paddingLeft: '1.1rem' }}>
                  {ds.map((x, i) => (
                    <li key={i}>
                      The <b>{roleNames(a, x.signer)}</b> {DECISION_VERB[x.decision]} this · {fmtTime(x.timestamp)}
                      {x.noteHash !== ZERO_BYTES32 && noteText[x.noteHash] && <> — “{noteText[x.noteHash]}”</>}
                    </li>
                  ))}
                </ul>
              )}

              {role && f.status !== 4 && (
                <div className="actions">
                  <input value={note} onChange={(e) => setNotes({ ...notes, [f.key]: e.target.value })} placeholder="Add a note (optional, required to disagree)" />
                  <div className="row">
                    {canAssign && <button onClick={() => decide(f, DecisionType.RequireRemediation)} disabled={!!busy}>Developer must fix this</button>}
                    {canAccept && <button onClick={() => decide(f, DecisionType.AcceptRisk)} disabled={!!busy}>I accept this risk</button>}
                    {!ackedByMe && <button className="ghost" onClick={() => decide(f, DecisionType.Acknowledge)} disabled={!!busy}>I have seen this</button>}
                    <button className="ghost" onClick={() => decide(f, DecisionType.Dispute)} disabled={!!busy || !note.trim()}>I disagree</button>
                  </div>
                  <span className="small muted">
                    You sign with your wallet. The signature covers this exact finding, so nobody can later claim you saw something else. No signature can mark it fixed; only Chainlink can.
                  </span>
                </div>
              )}

              {showEvidence && (
                <div className="evidence stack" style={{ marginTop: '0.75rem' }}>
                  <div>Evidence hash (what signatures cover): {f.evidenceHash}</div>
                  <div>Details hash on-chain: {f.detailsHash} {d && '✓ matches the off-chain report'}</div>
                  <div>First found in check #{f.firstCheck}, last checked in #{f.lastCheck}{f.resolvedInCheck ? `, fixed in #${f.resolvedInCheck}` : ''}</div>
                  {ds.map((x, i) => <div key={i}>Signature by {x.signer}: {x.signature.slice(0, 42)}…</div>)}
                </div>
              )}
            </article>
          )
        })}
      </div>

      {matches.length > 0 && (
        <details style={{ marginTop: '1rem' }}>
          <summary>✅ {matches.length} terms match the agreement</summary>
          <ul className="small">
            {matches.map((f) => {
              const d = details[f.detailsHash]
              return <li key={f.key}><b>{d?.clause ?? 'Term'}</b>: {d?.expected ?? '—'}</li>
            })}
          </ul>
        </details>
      )}

      {/* ---- History + contracts ---- */}
      <div className="grid two" style={{ marginTop: '2rem' }}>
        <section>
          <h2>What happened</h2>
          <ul className="timeline">
            {events.map((e, i) => (
              <li key={i}>
                <div>{e.text}</div>
                {e.note && <div className="small">“{e.note}”</div>}
                <div className="small muted">{fmtTime(e.t)}</div>
=======
                <div className="small muted">source hash <code>{c.codeHash.slice(0, 18)}…</code></div>
                <div className="small muted">evidence report <code>{c.reportHash}</code></div>
                <div className="small"><a href={`/api/evidence/${c.reportHash}`} download>Download canonical JSON evidence</a></div>
>>>>>>> df31607 (Align LexDiff with evidence-first design)
              </li>
            ))}
          </ul>
          <p className="small muted">Every entry is signed or written by Chainlink on Sepolia, and nothing can be edited afterwards.</p>
        </section>

        <section>
          <h2>The contracts</h2>
          <div className="panel small stack">
<<<<<<< HEAD
=======
            <div>Client <code>{a.client}</code></div>
            <div>Reviewer <code>{a.reviewer}</code></div>
            <div>Developer <code>{a.developer}</code></div>
            <div>Immutable CRE verifier <code>{a.verifier}</code></div>
>>>>>>> df31607 (Align LexDiff with evidence-first design)
            <div>
              <b>Escrow contract</b>: holds the money and is what Chainlink checks.
              <ol style={{ margin: '0.25rem 0 0' }}>
                {history.map((h, i) => (
                  <li key={i}>
                    <a className="mono" href={`${EXPLORER}/address/${h}#code`} target="_blank">{shortAddr(h)}</a>{' '}
                    {i === history.length - 1 ? <span className="badge tone-info">in use</span> : <span className="muted">replaced</span>}
                  </li>
                ))}
              </ol>
              {pending && <div>Proposed replacement <code>{shortAddr(a.pendingTarget)}</code> <span className="badge tone-warn">waiting for the client</span></div>}
            </div>
<<<<<<< HEAD
            <div>
              <b>LexDiff record</b>: stores fingerprints (hashes) of the terms, findings and signatures. It never touches the money.
            </div>
            <div>
              <b>Checked by</b>: Chainlink CRE{' '}
              {isMock ? <span className="badge tone-warn">simulation</span> : <span className="badge tone-ok">production forwarder</span>}
              <div className="muted">Chosen and signed by the parties at registration. Nobody can change it.</div>
            </div>
            {showEvidence && (
              <div className="evidence stack">
                <div>Client {a.client}</div>
                <div>Reviewer {a.reviewer}</div>
                <div>Developer {a.developer}</div>
                <div>Terms fingerprint {a.termsHash} · <a href={a.termsURI} target="_blank">terms</a></div>
                <div>Forwarder {a.verifier.forwarder}</div>
                {checks.map((c, i) => <div key={i}>Check #{i + 1}: source {c.codeHash} · report {c.reportHash}</div>)}
              </div>
            )}
          </div>
          {role && (
            <button className="ghost small" style={{ marginTop: '0.75rem' }} disabled={!!busy} onClick={() => run('Requesting a new check', async () => void (await writeRegistry('requestCheck', [id])))}>
              Ask Chainlink to check again
            </button>
=======
          </div>

          <h2>On-chain event trail</h2>
          <ul className="timeline">
            {events.map((event, index) => (
              <li key={`${event.transactionHash}-${index}`}>
                <b>{event.eventName}</b> · block {event.blockNumber.toString()}{' '}
                <a href={`${EXPLORER}/tx/${event.transactionHash}`} target="_blank" rel="noreferrer">view transaction</a>
              </li>
            ))}
          </ul>

          {(isClient || isDeveloper) && (
            <div className="panel stack" style={{ marginTop: '1rem' }}>
              <h3 style={{ margin: 0 }}>Redeploy &amp; re-check</h3>
              <label>New contract address</label>
              <input className="mono" value={newTarget} onChange={(e) => setNewTarget(e.target.value)} placeholder="0x…" />
              {pendingTarget !== '0x0000000000000000000000000000000000000000' && (
                <p className="notice small">Pending developer proposal: <code>{pendingTarget}</code></p>
              )}
              <div className="row">
                {isDeveloper && (
                <button
                  disabled={!!busy || !isAddress(newTarget)}
                  onClick={() => run('Proposing contract', async () => void (await writeRegistry('proposeContract', [id, newTarget])))}
                >
                  Developer: propose contract
                </button>
                )}
                {isClient && pendingTarget !== '0x0000000000000000000000000000000000000000' && (
                  <button onClick={() => run('Accepting contract', async () => void (await writeRegistry('acceptContract', [id])))} disabled={!!busy}>
                    Client: accept proposal
                  </button>
                )}
                <button className="ghost" disabled={!!busy} onClick={() => run('Requesting check', async () => void (await writeRegistry('requestCheck', [id])))}>
                  Request CRE check
                </button>
              </div>
              <p className="small muted">Only client acceptance changes the active contract and emits <code>CheckRequested</code>.</p>
              <pre>{simulateCmd}</pre>
            </div>
>>>>>>> df31607 (Align LexDiff with evidence-first design)
          )}
        </section>
      </div>
    </>
  )
}
