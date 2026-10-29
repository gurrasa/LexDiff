'use client'

import Link from 'next/link'
import { useParams } from 'next/navigation'
import { useCallback, useEffect, useState } from 'react'
import { type Address, formatUnits, type Hex, isAddress } from 'viem'
import { isFailing, KIND_PLAIN, ROLES, type Role, rolesOf, roleNames, STEPS, stageOf } from '@/lib/plain'
import {
  type Agreement,
  type AgreementDocument,
  type AgreementEvent,
  type Check,
  connectWallet,
  DECISION_TYPES,
  type Decision,
  DecisionType,
  DISPOSITION,
  Disposition,
  DOMAIN,
  EXPLORER,
  type Finding,
  fmtTime,
  getEvidence,
  KIND,
  noteValue,
  putEvidence,
  LEVEL_PLAIN,
  type Level,
  type ReportDocument,
  REMEDIATION,
  Remediation,
  registry,
  watchAccount,
  same,
  shortAddr,
  VERIFICATION,
  Verification,
  writeRegistry,
  ZERO_BYTES32,
} from '@/lib/registry'
import type { EscrowTerms } from '@/lib/terms'

type Details = { clause: string; expected: string; actual: string; level?: Level; method?: string }
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
  chainEvents: AgreementEvent[]
  document: AgreementDocument | null
}

const ZERO = '0x0000000000000000000000000000000000000000'

const fmtAmount = (raw: string, terms: EscrowTerms | null) =>
  terms ? `${formatUnits(BigInt(raw), terms.payment.decimals)} ${terms.payment.tokenSymbol}` : raw

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
    const [agreement, findings, checks, history, chainEvents] = await Promise.all([
      registry.getAgreement(id),
      registry.getFindings(id),
      registry.getChecks(id),
      registry.getContractHistory(id),
      registry.getEvents(id).catch(() => [] as AgreementEvent[]),
    ])
    const [terms, reports, document] = await Promise.all([
      getEvidence<EscrowTerms>(agreement.termsHash, agreement.termsURI),
      Promise.all(checks.map((c) => getEvidence<ReportDocument>(c.reportHash))),
      getEvidence<AgreementDocument>(agreement.agreementHash),
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
    setData({ agreement, terms, findings, checks, reports, details, past, history, decisions, notes: noteText, chainEvents, document })
  }, [id])

  // Follow MetaMask: switching account switches role, so each person sees only their own actions.
  useEffect(
    () =>
      watchAccount((next) => {
        setAccount(next)
        setActingAs(null)
      }),
    [],
  )

  useEffect(() => {
    load().catch((e) => setError(String(e?.shortMessage ?? e)))
    fetch('/api/demo')
      .then((r) => r.json())
      .then((d) => d.escrowV2 && setNewTarget((t) => t || d.escrowV2))
      .catch(() => {})
  }, [load])

  // While a check is pending, poll the chain so the report shows up without a manual reload.
  const waitingForChainlink = !!data && stageOf(data.agreement, data.findings, data.checks).waitingFor === 'chainlink'
  useEffect(() => {
    if (!waitingForChainlink) return
    const timer = setInterval(() => load().catch(() => {}), 10_000)
    return () => clearInterval(timer)
  }, [waitingForChainlink, load])

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

  const { agreement: a, terms, findings, checks, details, past, history, decisions, notes: noteText, chainEvents, document: agreementDoc } = data
  const myRoles = rolesOf(a, account)
  const role = actingAs && myRoles.includes(actingAs) ? actingAs : (myRoles[0] ?? null)
  const stage = stageOf(a, findings, checks)
  // A property has a story when it failed at some point, was not checked, or someone decided on it.
  const hasStory = (f: Finding) =>
    f.verification !== Verification.Pass || f.lastFailedCheck !== 0 || f.remediation !== Remediation.None || f.disposition !== Disposition.Undecided
  const rank = (f: Finding) => (isFailing(f) ? 0 : f.verification === Verification.NotChecked ? 1 : 2)
  const issues = findings.filter(hasStory).sort((x, y) => rank(x) - rank(y))
  const matches = findings.filter((f) => !hasStory(f))
  const latestReport = data.reports.at(-1)
  const coverage = latestReport?.coverage
  const operational = latestReport?.operational
  const pending = a.pendingTarget !== ZERO
  const isMock = same(a.verifier.forwarder, '0x15fC6ae953E024d975e77382eEeC56A9101f9F88')
  const simulateCmd = `cd cre && cre workflow simulate lexdiff-workflow --target staging-settings --broadcast \\\n  --non-interactive --trigger-index 0 --http-payload '{"agreementId":${idParam}}'`
  const clauseOf = (f: Finding) => (f.detailsHash === ZERO_BYTES32 ? past[f.key]?.at(-1)?.clause : details[f.detailsHash]?.clause) ?? 'Unknown term'

  const downloadRecord = () => {
    // Self-contained: the off-chain documents travel with the record, so /verify (or anyone) can
    // re-hash them against the on-chain anchors without trusting LexDiff's evidence store.
    const documents: Record<string, unknown> = {}
    if (agreementDoc) documents[a.agreementHash] = agreementDoc
    if (terms) documents[a.termsHash] = terms
    checks.forEach((c, i) => {
      if (data.reports[i]) documents[c.reportHash] = data.reports[i]
    })
    for (const [hash, note] of Object.entries(noteText)) documents[hash] = noteValue(note)
    const record = {
      schema: 'lexdiff/case-record@3',
      exportedAt: new Date().toISOString(),
      chainId: 11155111,
      registry: process.env.NEXT_PUBLIC_REGISTRY_ADDRESS,
      agreementId: id,
      agreement: a,
      contractHistory: history,
      checks,
      findings,
      decisions,
      events: chainEvents.map((event) => ({
        ...event,
        explorerUrl: `${EXPLORER}/tx/${event.transactionHash}`,
      })),
      documents,
      limitations: [
        'Hashes prove these documents are the ones anchored on-chain, not that their content is true or legally valid.',
        'A wallet signature proves control of a key, not the legal identity or authority of the signer.',
        'Structural checks read the verified source code; they do not execute it.',
        'An accepted risk is still a failing property. Approving a contract does not move funds.',
      ],
    }
    const json = JSON.stringify(record, (_key, value) => typeof value === 'bigint' ? value.toString() : value, 2)
    const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }))
    const link = document.createElement('a')
    link.href = url
    link.download = `lexdiff-agreement-${idParam}-record.json`
    link.click()
    URL.revokeObjectURL(url)
  }

  // Plain-language history of everything that happened.
  const events: { t: bigint; text: string; note?: string }[] = [
    { t: a.createdAt, text: 'Agreement registered. The reviewer and the client signed the terms.' },
    ...checks.map((c, i) => ({
      t: c.timestamp,
      text: `Chainlink check #${i + 1} of contract ${shortAddr(c.target)}: ${c.passed} pass, ${c.failed} fail${c.inconclusive ? `, ${c.inconclusive} inconclusive` : ''}.`,
    })),
    ...findings.flatMap((f) =>
      (decisions[f.key] ?? []).map((d) => ({
        t: d.timestamp,
        text: `The ${roleNames(a, d.signer)} ${DECISION_VERB[d.decision]}: ${clauseOf(f)}.`,
        note: d.noteHash !== ZERO_BYTES32 ? noteText[d.noteHash] : undefined,
      })),
    ),
    ...findings
      .filter((f) => f.remediation === Remediation.FixVerified)
      .map((f) => ({ t: f.fixVerifiedAt, text: `Chainlink verified the fix: ${clauseOf(f)} now passes.` })),
  ].sort((x, y) => Number(x.t - y.t))

  const nextAction = () => {
    if (stage.waitingFor === 'chainlink') {
      return (
        <div className="stack">
          <p className="small" style={{ margin: 0 }}>
            ⏳ The request is on Sepolia (<code>CheckRequested</code>). The Chainlink CRE workflow picks it up on its own;
            this page updates when the report arrives, usually within a couple of minutes.
          </p>
          {role && (
            <div className="row">
              <button
                className="ghost"
                disabled={!!busy}
                onClick={() => run('Requesting a Chainlink check on Sepolia', async () => void (await writeRegistry('requestCheck', [id])))}
              >
                Request a new Chainlink check
              </button>
            </div>
          )}
          <details>
            <summary>Running the checker yourself (simulation)</summary>
            <p className="small">
              In this demo the workflow runs through the CRE CLI simulator. Keep <code>node watch.ts</code> running in{' '}
              <code>cre/lexdiff-workflow</code> and it answers every request automatically. On a local install you can also run one check directly:
            </p>
            <div className="row">
              <button onClick={runCheck} disabled={!!busy}>Run the check on this machine</button>
            </div>
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
          Approve {shortAddr(a.pendingTarget)} as the contract to fund
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
      {coverage && (
        <section className="panel small" style={{ marginTop: '1rem' }}>
          <b>What was checked.</b> {coverage.checked} agreement terms compared: {coverage.byLevel.value}{' '}
          {LEVEL_PLAIN.value.icon} by reading the contract&apos;s values on Sepolia, {coverage.byLevel.structural}{' '}
          {LEVEL_PLAIN.structural.icon} by analysing its verified source code.
          {coverage.unchecked.length > 0 ? (
            <>
              <div style={{ marginTop: '0.5rem' }}>
                <b>Not checked automatically ({coverage.unchecked.length})</b>: these need a human to review.
              </div>
              <ul style={{ margin: '0.25rem 0 0' }}>
                {coverage.unchecked.map((u, i) => (
                  <li key={i}>
                    <span className="badge tone-muted">{u.term}</span> {u.text} <span className="muted">· {u.reason}</span>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <div>Every term in the agreement was checked.</div>
          )}
        </section>
      )}
      {checks.length > 0 && issues.length === 0 && <p className="notice">Every checked property passes.</p>}
      {operational && (
        <section className="panel small" style={{ marginTop: '1rem' }}>
          <b>Where the money is.</b> Approved contract {shortAddr(operational.target)} holds{' '}
          <b>{fmtAmount(operational.targetBalance, terms)}</b> of {fmtAmount(operational.expectedAmount, terms)}
          {BigInt(operational.targetBalance) >= BigInt(operational.expectedAmount) && BigInt(operational.expectedAmount) > BigInt(0)
            ? <span className="badge tone-ok" style={{ marginLeft: 6 }}>funded</span>
            : <span className="badge tone-muted" style={{ marginLeft: 6 }}>not funded yet</span>}
          {operational.previousTarget && operational.previousBalance !== null && BigInt(operational.previousBalance) > BigInt(0) && (
            <div className="error" style={{ marginTop: '0.5rem' }}>
              The previous contract {shortAddr(operational.previousTarget)} still holds {fmtAmount(operational.previousBalance, terms)}.
              Approving the new contract did not move these funds.
            </div>
          )}
          <div className="muted">Read from Sepolia by Chainlink in the latest check.</div>
        </section>
      )}

      <div className="stack" style={{ marginTop: '1rem' }}>
        {issues.map((f) => {
          const d = f.detailsHash === ZERO_BYTES32 ? null : details[f.detailsHash]
          const before = (past[f.key] ?? []).filter((p) => p.kind !== 0).at(-1)
          const ds = decisions[f.key] ?? []
          const failing = isFailing(f)
          const fixed = f.remediation === Remediation.FixVerified
          const tone = f.verification === Verification.Pass ? 'ok' : failing ? KIND[f.kind].tone : 'warn'
          const ackedByMe = ds.some((x) => x.decision === DecisionType.Acknowledge && x.atCheck === f.lastCheck && same(x.signer, account ?? ''))
          const canAccept = role === 'client' && failing && f.disposition !== Disposition.Accepted
          const canAssign =
            role === 'reviewer' && failing && (f.remediation === Remediation.None || f.remediation === Remediation.Reopened)
          const note = notes[f.key] ?? ''
          const v = VERIFICATION[f.verification]
          return (
            <article key={f.key} className={`finding tone-${tone}`}>
              <div className="row spread">
                <h3 style={{ margin: 0 }}>{f.verification === Verification.Pass ? '✅' : failing ? KIND[f.kind].icon : '❔'} {clauseOf(f)}</h3>
                <div className="row" style={{ gap: 6 }}>
                  <span className={`badge tone-${v.tone}`} title="Technical result of the latest check">{v.label}</span>
                  {f.remediation !== Remediation.None && (
                    <span className={`badge tone-${REMEDIATION[f.remediation].tone}`} title="Repair process">{REMEDIATION[f.remediation].label}</span>
                  )}
                  {f.disposition !== Disposition.Undecided && (
                    <span className={`badge tone-${DISPOSITION[f.disposition].tone}`} title="Risk decision">
                      {f.disposition === Disposition.Disputed ? '⚖️ ' : ''}{DISPOSITION[f.disposition].label}
                    </span>
                  )}
                </div>
              </div>
              <div className="small muted">
                {fixed ? 'Was: ' + KIND_PLAIN[before?.kind ?? f.kind].toLowerCase()
                  : f.verification === Verification.NotChecked ? 'Not assessed in the latest check: this is not a pass.'
                  : KIND_PLAIN[f.kind]}
                {failing && f.disposition === Disposition.Accepted && ' · Accepted by the client, but the property still fails.'}
              </div>

              {(d?.level ?? before?.level) && (
                <div className="small" style={{ marginTop: 4 }} title={d?.method ?? before?.method}>
                  {LEVEL_PLAIN[(d?.level ?? before?.level)!].icon} {LEVEL_PLAIN[(d?.level ?? before?.level)!].label}
                </div>
              )}
              <div className="says">
                <div><span>The agreement says</span>{d?.expected ?? before?.expected ?? '—'}</div>
                {fixed && before ? (
                  <div><span>The code did → now does</span>{before.actual} → {d?.actual ?? '—'}</div>
                ) : (
                  <div><span>The code does</span>{d?.actual ?? before?.actual ?? '—'}</div>
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

              {role && (
                <div className="actions">
                  <input value={note} onChange={(e) => setNotes({ ...notes, [f.key]: e.target.value })} placeholder="Add a note (optional, required to disagree)" />
                  <div className="row">
                    {canAssign && <button onClick={() => decide(f, DecisionType.RequireRemediation)} disabled={!!busy}>Developer must fix this</button>}
                    {canAccept && <button onClick={() => decide(f, DecisionType.AcceptRisk)} disabled={!!busy}>I accept this risk</button>}
                    {!ackedByMe && <button className="ghost" onClick={() => decide(f, DecisionType.Acknowledge)} disabled={!!busy}>I have seen this</button>}
                    <button className="ghost" onClick={() => decide(f, DecisionType.Dispute)} disabled={!!busy || !note.trim()}>I disagree</button>
                  </div>
                  <span className="small muted">
                    You sign with your wallet; the signature covers this exact finding. Decisions never change the technical result:
                    only a Chainlink check in which this same property passes can verify a fix.
                  </span>
                </div>
              )}

              {showEvidence && (
                <div className="evidence stack" style={{ marginTop: '0.75rem' }}>
                  <div>Evidence hash (what signatures cover): {f.evidenceHash}</div>
                  {(d?.method ?? before?.method) && <div>How it was checked: {d?.method ?? before?.method}</div>}
                  <div>Details hash on-chain: {f.detailsHash} {d && '✓ matches the off-chain report'}</div>
                  <div>
                    First assessed in check #{f.firstCheck}, last assessed in #{f.lastCheck}
                    {f.lastFailedCheck ? `, last failed in #${f.lastFailedCheck}` : ''}
                    {f.fixVerifiedInCheck ? `, fix verified in #${f.fixVerifiedInCheck}` : ''}
                  </div>
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
              return (
                <li key={f.key}>
                  <b>{d?.clause ?? 'Term'}</b>: {d?.expected ?? '—'}{' '}
                  {d?.level && <span className="muted" title={d.method}>{LEVEL_PLAIN[d.level].icon}</span>}
                </li>
              )
            })}
          </ul>
        </details>
      )}

      {/* ---- History + contracts ---- */}
      <div className="grid two" style={{ marginTop: '2rem' }}>
        <section>
          <h2>What happened</h2>
          <button className="ghost small" onClick={downloadRecord}>Export case record</button>
          <ul className="timeline">
            {events.map((e, i) => (
              <li key={i}>
                <div>{e.text}</div>
                {e.note && <div className="small">“{e.note}”</div>}
                <div className="small muted">{fmtTime(e.t)}</div>
              </li>
            ))}
          </ul>
          <details>
            <summary>Sepolia transaction trail</summary>
            <ul className="timeline">
              {chainEvents.map((event, index) => (
                <li key={`${event.transactionHash}-${index}`}>
                  <b>{event.eventName}</b> · block {event.blockNumber.toString()}{' '}
                  <a href={`${EXPLORER}/tx/${event.transactionHash}`} target="_blank" rel="noreferrer">view transaction</a>
                </li>
              ))}
            </ul>
          </details>
          <p className="small muted">Every entry is signed or written by Chainlink on Sepolia, and nothing can be edited afterwards.</p>
        </section>

        <section>
          <h2>The contracts</h2>
          <div className="panel small stack">
            <div>
              <b>Escrow contract</b>: what Chainlink checks, and what the client funds once approved.
              <ol style={{ margin: '0.25rem 0 0' }}>
                {history.map((h, i) => (
                  <li key={i}>
                    <a className="mono" href={`${EXPLORER}/address/${h}#code`} target="_blank">{shortAddr(h)}</a>{' '}
                    {i === history.length - 1 ? <span className="badge tone-info">approved</span> : <span className="muted">replaced</span>}
                  </li>
                ))}
              </ol>
              {pending && <div>Proposed replacement <code>{shortAddr(a.pendingTarget)}</code> <span className="badge tone-warn">waiting for the client</span></div>}
            </div>
            <div>
              <b>LexDiff record</b>: stores fingerprints (hashes) of the agreement, terms, findings and signatures. It never touches the money.
            </div>
            {agreementDoc && (
              <details>
                <summary>The signed agreement document</summary>
                <pre style={{ whiteSpace: 'pre-wrap' }}>{agreementDoc.text}</pre>
              </details>
            )}
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
                <div>Freelancer {a.freelancer}</div>
                <div>Agreement document fingerprint {a.agreementHash} {agreementDoc ? '✓' : '(document unavailable)'}</div>
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
