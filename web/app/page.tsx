'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { type Address, type Hex, zeroAddress } from 'viem'
import { ROLES, type Role, rolesOf, STEPS, stageOf } from '@/lib/plain'
import { Badge, EmptyState, Loading, Result, StatCard } from '@/components/ui'
import {
  type Agreement,
  type Check,
  connectWallet,
  type Finding,
  Verification,
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

const fmtDate = (ts: bigint) =>
  new Date(Number(ts) * 1000).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })

/** Fail and Inconclusive straight from the registry. Passes are not counted here: telling a structural Pass
 * (shown as Inconclusive) from an executed one needs the report, which only the agreement page loads. */
const issuesOf = (r: Row) => ({
  fail: r.findings.filter((f) => f.verification === Verification.Fail).length,
  inconclusive: r.findings.filter((f) => f.verification === Verification.Inconclusive).length,
})

const roleLabel = (r: Role) => (r === 'reviewer' ? 'lawyer' : ROLES[r].label.toLowerCase())

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

  // The summary covers your agreements once a wallet is connected, otherwise the whole registry.
  const scope = account ? mine : (rows ?? [])
  const issues = scope.map(issuesOf).reduce((a, b) => ({ fail: a.fail + b.fail, inconclusive: a.inconclusive + b.inconclusive }), { fail: 0, inconclusive: 0 })
  const decided = scope.filter((r) => stageOf(r.agreement, r.findings, r.checks).waitingFor === null).length
  const titleOf = (r: Row) => r.terms?.title ?? `Agreement #${r.id}`
  const activity = scope
    .flatMap((r) => [
      { t: r.agreement.createdAt, what: 'Agreement registered', where: titleOf(r) },
      ...r.checks.map((c, i) => {
        const found = [c.failed && `${c.failed} fail`, c.inconclusive && `${c.inconclusive} inconclusive`].filter(Boolean).join(', ')
        return { t: c.timestamp, what: `Chainlink check #${i + 1}${found ? `: ${found}` : ': no failures'}`, where: titleOf(r) }
      }),
    ])
    .sort((x, y) => Number(y.t - x.t))
    .slice(0, 6)

  const contractOf = (r: Row) =>
    same(r.agreement.target, zeroAddress) ? 'no contract yet' : <span className="mono">contract {shortAddr(r.agreement.target)}</span>

  const attentionCard = (row: Row) => {
    const roles = rolesOf(row.agreement, account)
    const stage = stageOf(row.agreement, row.findings, row.checks)
    const { fail, inconclusive } = issuesOf(row)
    const last = row.checks.at(-1)
    return (
      <article key={row.id.toString()} className="agreement-card attention">
        <div className="row spread" style={{ alignItems: 'flex-start' }}>
          <div style={{ flex: '1 1 280px', minWidth: 0 }}>
            <h3>{titleOf(row)}</h3>
            <div className="meta">
              #{row.id.toString()} · {contractOf(row)} · you are the {roles.map(roleLabel).join(' & ')}
            </div>
          </div>
          <Badge tone="info">Your turn · {STEPS[stage.step]}</Badge>
        </div>
        <p style={{ margin: 0 }}>{stage.title}.</p>
        <div className="foot">
          {last ? (
            <div className="result-line">
              <Result result="fail" size={14}>{fail} fail</Result>
              <Result result="inconclusive" size={14}>{inconclusive} inconclusive</Result>
              <span className="muted">Last checked {fmtDate(last.timestamp)}</span>
            </div>
          ) : (
            <span className="small muted">{same(row.agreement.target, zeroAddress) ? 'No contract yet' : 'Contract approved'} · not checked</span>
          )}
          <Link href={`/agreements/${row.id}`} className="button">View agreement</Link>
        </div>
      </article>
    )
  }

  const rowCard = (row: Row) => {
    const stage = stageOf(row.agreement, row.findings, row.checks)
    const last = row.checks.at(-1)
    const w = stage.waitingFor
    return (
      <Link key={row.id.toString()} href={`/agreements/${row.id}`} className="agreement-row">
        <div>
          <h3>{titleOf(row)}</h3>
          <div className="small muted">
            #{row.id.toString()} · {contractOf(row)}
            {last && <> · checked {fmtDate(last.timestamp)}</>}
          </div>
        </div>
        {w === null ? (
          <Badge tone="ok">Decided</Badge>
        ) : (
          <Badge tone="muted">Waiting for {w === 'chainlink' ? 'Chainlink' : `the ${roleLabel(w)}`}</Badge>
        )}
        <span style={{ color: 'var(--accent)', fontWeight: 500 }}>View</span>
      </Link>
    )
  }

  if (!REGISTRY_ADDRESS) {
    return <p className="notice">Set <code>NEXT_PUBLIC_REGISTRY_ADDRESS</code> in <code>web/.env.local</code> to the deployed LexDiffRegistry.</p>
  }

  return (
    <>
      <section className="page-head">
        <div>
          <h1>{account ? 'Your agreements' : 'Does the smart contract do what the parties signed?'}</h1>
          <p className="lede" style={{ margin: 0 }}>
            Check that each smart contract does what the parties signed, and keep a signed record of every decision.
          </p>
        </div>
        <div className="row">
          {!account && (
            <button className="ghost" onClick={() => connectWallet().then((w) => setAccount(w.account)).catch((e) => setError(e.message))}>
              Connect wallet
            </button>
          )}
          <Link href="/new" className="button">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
            Create agreement
          </Link>
        </div>
      </section>
      {error && <p className="error">{error}</p>}

      <section aria-label="Summary" className="stats">
        <StatCard label="Total agreements" value={rows ? rows.length : '…'} sub="on this registry" />
        <StatCard
          label="Waiting for you"
          value={account ? yourTurn.length + pending.length : '—'}
          highlight={!!account && yourTurn.length + pending.length > 0}
          sub={account ? `${yourTurn.length} to act on · ${pending.length} to sign` : 'connect a wallet'}
        />
        <StatCard
          label="Verification issues"
          icon="fail"
          color="var(--bad)"
          value={rows ? issues.fail + issues.inconclusive : '…'}
          sub={`${issues.fail} fail · ${issues.inconclusive} inconclusive`}
        />
        <StatCard label="Active agreements" value={rows ? scope.length - decided : '…'} sub={`${decided} decided`} />
      </section>

      <div className="columns">
        <div className="primary">
          {rows === null && <Loading />}

          {rows && account && (
            <>
              <section aria-labelledby="attention" className="stack">
                <h2 id="attention" className="section-title">Needs your attention</h2>
                {pending.map((p) => (
                  <article key={p.id} className="agreement-card">
                    <div className="row spread" style={{ alignItems: 'flex-start' }}>
                      <div style={{ flex: '1 1 280px', minWidth: 0 }}>
                        <h3>{p.title}</h3>
                        <div className="meta">
                          Signing request · {p.role === 'reviewer' ? 'with the client' : 'from the lawyer'} <span className="mono">{shortAddr(p.other)}</span>
                        </div>
                      </div>
                      <Badge tone="info">Waiting for your signature</Badge>
                    </div>
                    <p style={{ margin: 0 }}>
                      Review the agreement and the terms the AI extracted, then sign as the {p.role === 'reviewer' ? 'lawyer' : 'client'}.
                      Nothing is on-chain until both of you sign.
                    </p>
                    <div className="foot">
                      <span className="small muted">No contract yet · not checked</span>
                      <Link href={`/sign/${p.id}`} className="button ghost">Review and sign</Link>
                    </div>
                  </article>
                ))}
                {yourTurn.map(attentionCard)}
                {yourTurn.length === 0 && pending.length === 0 && (
                  mine.length === 0 ? (
                    <EmptyState title="No agreements yet" action={{ href: '/new', label: 'Create agreement' }}>
                      A lawyer starts one and sends the client a signing link. The developer sees it here once it is registered with
                      their wallet.
                    </EmptyState>
                  ) : (
                    <EmptyState title="Nothing needs you right now">Your agreements are waiting for someone else, or are decided.</EmptyState>
                  )
                )}
              </section>

              {waiting.length > 0 && (
                <section aria-labelledby="waiting" className="stack">
                  <h2 id="waiting" className="section-title">Waiting for others</h2>
                  {waiting.map(rowCard)}
                </section>
              )}
            </>
          )}

          {rows && !account && (
            <section className="stack">
              <h2 className="section-title">Agreements on this registry</h2>
              {rows.length === 0 ? (
                <EmptyState title="No agreements yet" action={{ href: '/new', label: 'Create agreement' }}>
                  A lawyer starts one and sends the client a signing link.
                </EmptyState>
              ) : (
                rows.map(rowCard)
              )}
            </section>
          )}

          {account && others.length > 0 && (
            <details>
              <summary>Other agreements on this registry ({others.length})</summary>
              <div className="stack" style={{ marginTop: 12 }}>{others.map(rowCard)}</div>
            </details>
          )}
        </div>

        <aside>
          <section aria-labelledby="recent" className="panel">
            <h2 id="recent">Recent activity</h2>
            {rows === null ? (
              <p className="small muted" style={{ margin: 0 }}>Loading from Sepolia…</p>
            ) : activity.length === 0 ? (
              <p className="small muted" style={{ margin: 0 }}>Nothing yet.</p>
            ) : (
              <ol className="activity">
                {activity.map((e, i) => (
                  <li key={i}>
                    <div className="what">{e.what}</div>
                    <div className="when">{e.where} · {fmtDate(e.t)}</div>
                  </li>
                ))}
              </ol>
            )}
          </section>

          <section id="how" aria-labelledby="how-title" className="panel subtle">
            <h2 id="how-title" style={{ fontFamily: 'inherit', fontSize: 14 }}>How LexDiff works</h2>
            <ol style={{ margin: 0, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 6, fontSize: 13, color: 'var(--ink-soft)' }}>
              <li>The lawyer and the client sign the agreement and its terms.</li>
              <li>The developer proposes the contract; the client approves it.</li>
              <li>Chainlink checks the deployed contract against every term.</li>
              <li>Each failing property is fixed or knowingly accepted, with a signature.</li>
              <li>A fix counts only when Chainlink sees the property pass.</li>
            </ol>
            <p className="small muted" style={{ margin: '10px 0 0' }}>
              LexDiff keeps evidence; it does not decide who is liable. A wallet signature proves control of a key, not someone&apos;s
              legal identity. Only fingerprints (hashes) are stored on-chain.
            </p>
          </section>
        </aside>
      </div>
    </>
  )
}
