'use client'

import { useParams } from 'next/navigation'
import { Fragment, useCallback, useEffect, useState } from 'react'
import { type Address, isAddress, keccak256, toBytes } from 'viem'
import { sepolia } from 'viem/chains'
import {
  type Agreement,
  type Check,
  connectWallet,
  DECISION_LABEL,
  DECISION_TYPES,
  type Decision,
  DecisionType,
  EXPLORER,
  type Finding,
  fmtTime,
  KIND,
  REGISTRY_ADDRESS,
  registry,
  STATUS,
  STATUS_TONE,
  shortAddr,
  writeRegistry,
} from '@/lib/registry'

type Data = {
  agreement: Agreement
  findings: Finding[]
  checks: Check[]
  history: Address[]
  decisions: Record<string, Decision[]>
}

const same = (a?: string, b?: string) => !!a && !!b && a.toLowerCase() === b.toLowerCase()

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
    const decisions: Record<string, Decision[]> = {}
    await Promise.all(findings.map(async (f) => (decisions[f.key] = await registry.getDecisions(id, f.key))))
    setData({ agreement, findings, checks, history, decisions })
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
    run(decision === DecisionType.AcceptRisk ? 'Signing Accepted risk' : 'Signing Remediation required', async () => {
      const { wallet, account } = await connectWallet()
      const nonce = await registry.nonces(account)
      const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600)
      const signature = await wallet.signTypedData({
        account,
        domain: { name: 'LexDiff', version: '1', chainId: sepolia.id, verifyingContract: REGISTRY_ADDRESS },
        types: DECISION_TYPES,
        primaryType: 'Decision',
        message: {
          agreementId: id,
          findingKey: f.key,
          decision,
          evidenceHash: f.evidenceHash,
          noteHash: keccak256(toBytes(note)),
          nonce,
          deadline,
        },
      })
      setBusy('Recording signed decision on-chain')
      await writeRegistry('submitDecision', [id, f.key, decision, f.evidenceHash, note, deadline, account, signature])
      setNote('')
      setExpanded(null)
    })

  if (error && !data) return <p className="error">{error}</p>
  if (!data) return <p className="muted">Loading agreement #{idParam} from Sepolia…</p>

  const { agreement: a, findings, checks, history, decisions } = data
  const isClient = same(account ?? '', a.client)
  const isReviewer = same(account ?? '', a.reviewer)
  const isDeveloper = same(account ?? '', a.developer)
  const roles = [isClient && 'client', isReviewer && 'reviewer', isDeveloper && 'developer'].filter(Boolean)
  const count = (s: number) => findings.filter((f) => f.status === s).length
  const sorted = [...findings].sort((x, y) => (x.kind === 0 ? 1 : 0) - (y.kind === 0 ? 1 : 0) || x.firstCheck - y.firstCheck)
  const simulateCmd = `cd cre && cre workflow simulate lexdiff-workflow --target staging-settings --broadcast \\\n  --non-interactive --trigger-index 0 --http-payload '{"agreementId":${idParam}}'`

  return (
    <>
      <div className="row spread">
        <div>
          <span className="muted small">Agreement #{idParam}</span>
          <h1>{a.title}</h1>
        </div>
        <div className="row">
          {account ? (
            <span className="badge tone-info mono">{shortAddr(account)} · {roles.length ? roles.join(', ') : 'no role'}</span>
          ) : (
            <button onClick={connect}>Connect wallet</button>
          )}
        </div>
      </div>
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
                const canAccept = isClient && f.kind !== 0 && (f.status === 1 || f.status === 3)
                const canAssign = isReviewer && f.kind !== 0 && (f.status === 1 || f.status === 2)
                const open = expanded === f.key
                return (
                  <Fragment key={f.key}>
                    <tr>
                      <td>
                        <span className={`badge tone-${kind.tone}`}>{kind.icon} {kind.label}</span>
                        <div style={{ marginTop: 4 }}><b>{f.clause}</b></div>
                      </td>
                      <td className="small">{f.expected}</td>
                      <td className="small">{f.actual}</td>
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
                                    {d.note && <div>“{d.note}”</div>}
                                    <div className="muted">EIP-712 sig <code>{d.signature.slice(0, 18)}…</code> over evidence <code>{d.evidenceHash.slice(0, 10)}…</code></div>
                                  </li>
                                ))}
                                {f.status === 4 && <li><b>Resolved</b> — CRE confirmed in check #{f.resolvedInCheck} · {fmtTime(f.resolvedAt)}</li>}
                              </ul>
                            </div>
                            <div className="stack">
                              {(canAccept || canAssign) ? (
                                <>
                                  <label>Note (signed together with the decision)</label>
                                  <textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Reason, clause reference…" />
                                  <div className="row">
                                    {canAccept && (
                                      <button onClick={() => decide(f, DecisionType.AcceptRisk)} disabled={!!busy}>Sign: Accepted risk</button>
                                    )}
                                    {canAssign && (
                                      <button onClick={() => decide(f, DecisionType.RequireRemediation)} disabled={!!busy}>Sign: Remediation required</button>
                                    )}
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
      )}

      <div className="grid two" style={{ marginTop: '1rem' }}>
        <section>
          <h2>CRE checks</h2>
          {checks.length === 0 && <p className="muted">None yet.</p>}
          <ul className="timeline">
            {[...checks].reverse().map((c, i) => (
              <li key={i}>
                <b>Check #{checks.length - i}</b> · {fmtTime(c.timestamp)}
                <div className="small">
                  contract <a className="mono" href={`${EXPLORER}/address/${c.target}#code`} target="_blank">{shortAddr(c.target)}</a> ·{' '}
                  {c.findingCount} terms compared · {c.nonMatchCount} not matching
                </div>
                <div className="small muted">source hash <code>{c.codeHash.slice(0, 18)}…</code></div>
              </li>
            ))}
          </ul>
        </section>

        <section>
          <h2>Record</h2>
          <div className="panel small stack">
            <div>Client <code>{a.client}</code></div>
            <div>Reviewer <code>{a.reviewer}</code></div>
            <div>Developer <code>{a.developer}</code></div>
            <div>
              Terms <a href={a.termsURI} target="_blank">{a.termsURI.length > 60 ? `${a.termsURI.slice(0, 60)}…` : a.termsURI}</a>
              <div className="muted">hash <code>{a.termsHash}</code></div>
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
            </div>
          </div>

          {(isClient || isReviewer || isDeveloper) && (
            <div className="panel stack" style={{ marginTop: '1rem' }}>
              <h3 style={{ margin: 0 }}>Redeploy &amp; re-check</h3>
              <label>New contract address</label>
              <input className="mono" value={newTarget} onChange={(e) => setNewTarget(e.target.value)} placeholder="0x…" />
              <div className="row">
                <button
                  disabled={!!busy || !isAddress(newTarget)}
                  onClick={() => run('Updating contract', async () => void (await writeRegistry('updateContract', [id, newTarget])))}
                >
                  Point agreement to new contract
                </button>
                <button className="ghost" disabled={!!busy} onClick={() => run('Requesting check', async () => void (await writeRegistry('requestCheck', [id])))}>
                  Request CRE check
                </button>
              </div>
              <p className="small muted">Both emit <code>CheckRequested</code>. To run the workflow locally:</p>
              <pre>{simulateCmd}</pre>
            </div>
          )}
        </section>
      </div>
    </>
  )
}
