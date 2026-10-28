'use client'

import Link from 'next/link'
import { useParams } from 'next/navigation'
import { useCallback, useEffect, useState } from 'react'
import { type Address, type Hex, isAddress } from 'viem'
import { KIND_PLAIN, ROLES, type Role, rolesOf, roleNames, STATUS_PLAIN, STEPS, stageOf } from '@/lib/plain'
import {
  type Agreement,
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
import type { EscrowTerms } from '@/lib/terms'

type Details = { clause: string; expected: string; actual: string }
type Past = Details & { kind: number; check: number }

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
  notes: Record<string, string>
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
    const noteText: Record<string, string> = {}
    const hashes = new Set(Object.values(decisions).flat().map((d) => d.noteHash).filter((h) => h !== ZERO_BYTES32))
    await Promise.all(
      [...hashes].map(async (h) => {
        const v = await getEvidence<{ note: string }>(h)
        if (v) noteText[h] = v.note
      }),
    )
    setData({ agreement, terms, findings, checks, reports, details, past, history, decisions, notes: noteText })
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
    run('Waiting for your signature', async () => {
      const note = (notes[f.key] ?? '').trim()
      if (decision === DecisionType.Dispute && !note) throw new Error('Write why you disagree before disputing.')
      const { wallet, account } = await connectWallet()
      const noteHash = note ? (await putEvidence(noteValue(note))).hash : ZERO_BYTES32
      const nonce = await registry.nonces(account)
      const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600)
      const signature = await wallet.signTypedData({
        account,
        domain: DOMAIN(),
        types: DECISION_TYPES,
        primaryType: 'Decision',
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
    })

  if (error && !data) return <p className="error">{error}</p>
  if (!data) return <p className="muted">Loading agreement #{idParam} from Sepolia…</p>

  const { agreement: a, terms, findings, checks, details, past, history, decisions, notes: noteText } = data
  const myRoles = rolesOf(a, account)
  const role = actingAs && myRoles.includes(actingAs) ? actingAs : (myRoles[0] ?? null)
  const stage = stageOf(a, findings, checks)
  const issues = findings.filter((f) => f.kind !== 0 || f.status === 4).sort((x, y) => x.status - y.status)
  const matches = findings.filter((f) => f.kind === 0 && f.status !== 4)
  const pending = a.pendingTarget !== ZERO
  const isMock = same(a.verifier.forwarder, '0x15fC6ae953E024d975e77382eEeC56A9101f9F88')
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
        <div className="stack" style={{ textAlign: 'right' }}>
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
              </li>
            ))}
          </ul>
          <p className="small muted">Every entry is signed or written by Chainlink on Sepolia, and nothing can be edited afterwards.</p>
        </section>

        <section>
          <h2>The contracts</h2>
          <div className="panel small stack">
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
          )}
        </section>
      </div>
    </>
  )
}
