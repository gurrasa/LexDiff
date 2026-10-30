'use client'

import Link from 'next/link'
import { useParams } from 'next/navigation'
import { useCallback, useEffect, useState } from 'react'
import { type Address, formatUnits, type Hex, isAddress } from 'viem'
import { isFailing, KIND_PLAIN, ROLES, type Role, rolesOf, roleNames, type Shown, shownResult, STEPS, stageOf } from '@/lib/plain'
import { Badge, EmptyState, Loading, Result, StatCard, type Tone } from '@/components/ui'
import {
  type Agreement,
  type AgreementDocument,
  autoUnlock,
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
  getEvidence,
  KIND,
  noteValue,
  putEvidence,
  type Level,
  type ReportDocument,
  REGISTRY_ADDRESS,
  REMEDIATION,
  Remediation,
  registry,
  watchAccount,
  same,
  shortAddr,
  storedAccess,
  submitSigned,
  unlockAccess,
  Verification,
  writeRegistry,
  ZERO_BYTES32,
} from '@/lib/registry'
import ContractPicker from '@/components/ContractPicker'
import { type Persona, PERSONA_LABEL, personas, setPersona } from '@/lib/identity'
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

type Filter = 'all' | Shown | 'decide'
type Tab = 'overview' | 'findings' | 'evidence'
const TABS: Tab[] = ['overview', 'findings', 'evidence']

const KIND_TONE: Tone[] = ['ok', 'warn', 'bad', 'power']

const fmtDate = (ts: bigint) =>
  new Date(Number(ts) * 1000).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })

const METHOD_SHORT = {
  value: 'read from the live contract on Sepolia',
  structural: 'analysis of the verified source only, not executed',
} as const

/** The agreement's own words for a clause, when Claude quoted them (sourceClauses). */
const QUOTE_FOR: [RegExp, RegExp][] = [
  [/review period/i, /reviewPeriod/i],
  [/^Client/, /parties\.client/i],
  [/^Freelancer/, /parties\.freelancer/i],
  [/token/i, /token/i],
  [/amount/i, /amount/i],
  [/Delivery/, /deliveryPeriod/i],
  [/Refund/i, /refund/i],
  [/Admin power/, /adminPowers/i],
]
const quoteOf = (terms: EscrowTerms | null, clause: string) => {
  const term = QUOTE_FOR.find(([c]) => c.test(clause))?.[1]
  const quote = term ? terms?.sourceClauses.find((s) => term.test(s.term))?.quote : undefined
  // Quotes come from a Markdown agreement: drop emphasis markers and the quotation marks we add ourselves.
  return quote?.replace(/\*\*?/g, '').replace(/^["“”\s]+|["“”\s]+$/g, '')
}

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
  const [demo, setDemo] = useState<{ escrowV1?: Address; escrowV2?: Address }>({})
  const [filter, setFilter] = useState<Filter>('all')
  const [tab, setTab] = useState<Tab>('overview')
  const [log, setLog] = useState('')
  const [presenting, setPresenting] = useState(false)
  const [localCre, setLocalCre] = useState(false)

  const load = useCallback(async () => {
    const [agreement, findings, checks, history, chainEvents] = await Promise.all([
      registry.getAgreement(id),
      registry.getFindings(id),
      registry.getChecks(id),
      registry.getContractHistory(id),
      registry.getEvents(id).catch(() => [] as AgreementEvent[]),
    ])
    // The agreement text and notes are private to the parties; terms and reports are public.
    const scope = { agreementId: id, account }
    await autoUnlock(account)
    const [terms, reports, document] = await Promise.all([
      getEvidence<EscrowTerms>(agreement.termsHash, agreement.termsURI),
      Promise.all(checks.map((c) => getEvidence<ReportDocument>(c.reportHash))),
      getEvidence<AgreementDocument>(agreement.agreementHash, undefined, scope),
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
        const v = await getEvidence<{ note: string }>(h, undefined, scope)
        if (v) noteText[h] = v.note
      }),
    )
    setData({ agreement, terms, findings, checks, reports, details, past, history, decisions, notes: noteText, chainEvents, document })
  }, [id, account])

  useEffect(() => {
    personas().then((p) => setPresenting(!!p))
    // The browser button for a local CRE run only works where the server enables it (never on a hosted app).
    fetch('/api/run-check').then((r) => r.json()).then((x) => setLocalCre(!!x.enabled)).catch(() => {})
    // A link to #findings or #evidence opens that tab.
    const fromHash = window.location.hash.slice(1) as Tab
    if (TABS.includes(fromHash)) setTab(fromHash)
  }, [])

  const openTab = (next: Tab) => {
    setTab(next)
    window.history.replaceState(null, '', `#${next}`)
    document.getElementById('tabs')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }
  // Arrow keys move between tabs (WAI-ARIA tabs pattern).
  const onTabKey = (e: React.KeyboardEvent) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return
    const next = TABS[(TABS.indexOf(tab) + (e.key === 'ArrowRight' ? 1 : TABS.length - 1)) % TABS.length]
    openTab(next)
    document.getElementById(`tab-${next}`)?.focus()
  }

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
      .then(setDemo)
      .catch(() => {})
  }, [load])

  // Live view: other parties' decisions and Chainlink reports show up without a reload. Poll faster while a
  // check is pending.
  const waitingForChainlink = !!data && stageOf(data.agreement, data.findings, data.checks).waitingFor === 'chainlink'
  useEffect(() => {
    const timer = setInterval(() => load().catch(() => {}), waitingForChainlink ? 8_000 : 15_000)
    return () => clearInterval(timer)
  }, [waitingForChainlink, load])

  const run = async (label: string, fn: () => Promise<void>) => {
    setBusy(label)
    setError('')
    try {
      await fn()
      await load()
      // Public RPC nodes can lag a block behind the one that mined the transaction: read again shortly.
      for (const ms of [3_000, 8_000]) setTimeout(() => load().catch(() => {}), ms)
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
      await submitSigned('submitDecision', [id, f.key, decision, f.evidenceHash, noteHash, deadline, account, signature])
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
  if (!data) return <Loading label={`Loading agreement #${idParam} from Sepolia…`} />

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
  const noContract = same(a.target, ZERO)
  // Demo convenience: the first proposal defaults to the flawed V1, a replacement to the corrected V2.
  const proposal = newTarget || (noContract ? demo.escrowV1 : demo.escrowV2) || ''
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
      registry: REGISTRY_ADDRESS,
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
        'An accepted risk is still a failing property. Choosing a contract for checking does not move funds.',
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

  // What each finding shows: a structural Pass (not executed) is Inconclusive on screen.
  const levelOf = (f: Finding) => (f.detailsHash === ZERO_BYTES32 ? undefined : details[f.detailsHash]?.level)
  const shownOf = (f: Finding) => shownResult(f.verification, levelOf(f))
  const countShown = (list: { result?: number; level?: Level }[]) => {
    const n = { pass: 0, fail: 0, inconclusive: 0 }
    for (const x of list) {
      const r = shownResult(x.result ?? 0, x.level)
      if (r !== 'not-checked') n[r]++
    }
    return n
  }

  // Plain-language history of everything that happened.
  const events: { t: bigint; text: string; who: string; note?: string; link?: { href: string; label: string } }[] = [
    {
      t: a.createdAt,
      text: 'Signed the agreement and the reviewed terms',
      who: 'Lawyer + Client',
      link: { href: a.termsURI, label: `terms ${a.termsHash.slice(0, 6)}…${a.termsHash.slice(-4)}` },
    },
    ...checks.map((c, i) => {
      const report = data.reports[i]
      // Counts follow the display rule when the report is available; otherwise only the on-chain failures.
      const n = report?.findings.some((x) => x.result !== undefined)
        ? countShown(report.findings)
        : { pass: null, fail: c.failed, inconclusive: c.inconclusive }
      const parts = [
        n.fail ? `${n.fail} fail` : null,
        n.inconclusive ? `${n.inconclusive} inconclusive` : null,
        n.pass ? `${n.pass} pass` : null,
      ].filter(Boolean)
      return {
        t: c.timestamp,
        text: `Checked contract ${shortAddr(c.target)}${parts.length ? ` · ${parts.join(', ')}` : ''}`,
        who: 'Chainlink CRE',
        link: { href: `${EXPLORER}/address/${c.target}#code`, label: `report ${c.reportHash.slice(0, 6)}…${c.reportHash.slice(-4)}` },
      }
    }),
    ...findings.flatMap((f) =>
      (decisions[f.key] ?? []).map((d) => ({
        t: d.timestamp,
        text: `${DECISION_VERB[d.decision][0].toUpperCase()}${DECISION_VERB[d.decision].slice(1)}: ${clauseOf(f)}`,
        who: roleNames(a, d.signer).replace(/^./, (c) => c.toUpperCase()),
        note: d.noteHash !== ZERO_BYTES32 ? noteText[d.noteHash] : undefined,
        link: { href: `${EXPLORER}/address/${d.signer}`, label: `EIP-712 · ${d.signature.slice(0, 6)}…${d.signature.slice(-4)}` },
      })),
    ),
    ...findings
      .filter((f) => f.remediation === Remediation.FixVerified)
      .map((f) => ({
        t: f.fixVerifiedAt,
        text: shownOf(f) === 'pass'
          ? `Fix verified: ${clauseOf(f)} now passes`
          : `Fix found in the code, not executed: ${clauseOf(f)}`,
        who: 'Chainlink CRE',
      })),
  ].sort((x, y) => Number(y.t - x.t))

  const structuralFixes = findings.filter((f) => f.remediation === Remediation.FixVerified && levelOf(f) === 'structural').length

  // In presentation mode, the next step's role is one click away.
  const ROLE_PERSONA: Partial<Record<Role, Persona>> = { reviewer: 'lawyer', client: 'client', developer: 'developer' }
  const switchTo = (r: Role, secondary = false) => {
    const p = ROLE_PERSONA[r]
    if (!presenting || !p || role === r) return null
    return (
      <button className={secondary ? 'ghost' : undefined} onClick={() => setPersona(p)}>
        Switch to {PERSONA_LABEL[p].icon} {PERSONA_LABEL[p].label} ▸
      </button>
    )
  }

  const reviewDecisions = () => {
    setFilter('decide')
    openTab('findings')
  }

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
                disabled={!!busy}
                onClick={() => run('Requesting a Chainlink check on Sepolia', async () => void (await writeRegistry('requestCheck', [id])))}
              >
                Request a new Chainlink check
              </button>
            </div>
          )}
        </div>
      )
    }
    if (stage.waitingFor === 'developer' && role === 'developer') {
      return (
        <div className="stack">
          <label>
            {noContract
              ? 'Which smart contract did you deploy for this agreement?'
              : `Which corrected contract should replace ${shortAddr(a.target)}?`}
          </label>
          <ContractPicker value={proposal} onChange={setNewTarget} />
          {noContract && (
            <p className="small muted" style={{ margin: 0 }}>
              It must name the client&apos;s and the payee&apos;s wallets from the agreement; Chainlink checks that too.
            </p>
          )}
          <button
            disabled={!!busy || !isAddress(proposal)}
            onClick={() => run('Proposing the contract', async () => void (await writeRegistry('proposeContract', [id, proposal])))}
          >
            Propose this contract
          </button>
        </div>
      )
    }
    if (stage.waitingFor === 'client' && pending && role === 'client') {
      return (
        <button onClick={() => run('Sending the contract for checking', async () => void (await writeRegistry('acceptContract', [id, a.pendingTarget])))} disabled={!!busy}>
          Send {shortAddr(a.pendingTarget)} to Chainlink for checking
        </button>
      )
    }
    if (stage.waitingFor === 'reviewer') {
      // Decisions: the lawyer requires fixes, the client can accept a risk. Both act on the findings.
      if (role === 'reviewer' || role === 'client') {
        return (
          <div className="row">
            <button onClick={reviewDecisions}>Review {counts.decide} finding{counts.decide === 1 ? '' : 's'}</button>
            {role === 'reviewer' && switchTo('client', true)}
          </div>
        )
      }
      return presenting ? switchTo('reviewer') : <p className="small" style={{ margin: 0 }}>Waiting for the lawyer or the client.</p>
    }
    if (stage.waitingFor && stage.waitingFor !== role && presenting) {
      return switchTo(stage.waitingFor as Role)
    }
    if (stage.waitingFor && stage.waitingFor !== role) {
      const who = ROLES[stage.waitingFor as Role].label.toLowerCase()
      return <p className="small" style={{ margin: 0 }}>{role ? `Waiting for the ${who}.` : `Connect the ${who}'s wallet to continue.`}</p>
    }
    return null
  }

  // Counters, filters and the finding list.
  const needsDecision = (f: Finding) =>
    isFailing(f) && f.remediation === Remediation.None && (f.disposition === Disposition.Undecided || f.disposition === Disposition.Disputed)
  const counts = {
    pass: findings.filter((f) => shownOf(f) === 'pass').length,
    fail: findings.filter((f) => shownOf(f) === 'fail').length,
    inconclusive: findings.filter((f) => shownOf(f) === 'inconclusive').length,
    'not-checked': findings.filter((f) => shownOf(f) === 'not-checked').length,
    decide: findings.filter(needsDecision).length,
  }
  const ORDER: Record<Shown, number> = { fail: 0, inconclusive: 1, 'not-checked': 2, pass: 3 }
  const visible = findings
    .filter((f) => filter === 'all' || (filter === 'decide' ? needsDecision(f) : shownOf(f) === filter))
    .sort((x, y) => ORDER[shownOf(x)] - ORDER[shownOf(y)])
  const FILTERS: { id: Filter; label: string; n: number }[] = [
    { id: 'all', label: 'All', n: findings.length },
    { id: 'fail', label: 'Fail', n: counts.fail },
    { id: 'inconclusive', label: 'Inconclusive', n: counts.inconclusive },
    { id: 'pass', label: 'Pass', n: counts.pass },
    { id: 'not-checked', label: 'Not checked', n: counts['not-checked'] },
    { id: 'decide', label: 'Needs a decision', n: counts.decide },
  ]
  const lastCheck = checks.at(-1)
  const TAB_LIST: { id: Tab; label: string; count?: number }[] = [
    { id: 'overview', label: 'Overview' },
    { id: 'findings', label: 'Findings', count: checks.length ? counts.fail + counts.inconclusive : undefined },
    { id: 'evidence', label: 'Evidence' },
  ]
  const canRequestCheck = !!role && !noContract

  const explanation = (f: Finding, shown: Shown, before?: Past) => {
    const fixed = f.remediation === Remediation.FixVerified
    if (shown === 'not-checked') return 'Not assessed in the latest check. This is not a pass.'
    if (fixed && shown === 'pass') return `Fixed. It used to be: ${KIND_PLAIN[before?.kind ?? f.kind].toLowerCase()}. Chainlink read the corrected value from the live contract.`
    if (fixed) return `The corrected contract has the required code, but it was not executed, so the fix is not confirmed. It used to be: ${KIND_PLAIN[before?.kind ?? f.kind].toLowerCase()}.`
    if (f.verification === Verification.Pass && shown === 'inconclusive') return 'The code has the right shape, but nothing was executed, so this is not confirmed.'
    if (f.verification === Verification.Inconclusive) return 'Chainlink could not decide this from the contract. Treat it as unresolved.'
    return KIND_PLAIN[f.kind] + (isFailing(f) && f.disposition === Disposition.Accepted ? '. Accepted by the client, but the property still fails.' : '.')
  }

  const statusNote = (f: Finding, shown: Shown) => {
    const parts: { text: string; tone: Tone }[] = []
    if (f.remediation === Remediation.FixVerified) {
      parts.push(shown === 'pass' ? { text: 'Fix verified by Chainlink', tone: 'ok' } : { text: 'Fix found in the code · not executed', tone: 'warn' })
    } else if (f.remediation !== Remediation.None) {
      parts.push({ text: REMEDIATION[f.remediation].label, tone: REMEDIATION[f.remediation].tone as Tone })
    }
    if (f.disposition !== Disposition.Undecided) {
      parts.push({
        text: DISPOSITION[f.disposition].label + (f.disposition === Disposition.Accepted && isFailing(f) ? ' · still shows Fail' : ''),
        tone: DISPOSITION[f.disposition].tone as Tone,
      })
    }
    return parts
  }

  const findingCard = (f: Finding) => {
    const d = f.detailsHash === ZERO_BYTES32 ? null : details[f.detailsHash]
    const before = (past[f.key] ?? []).filter((p) => p.kind !== 0).at(-1)
    const shown = shownOf(f)
    const ds = decisions[f.key] ?? []
    const failing = isFailing(f)
    const fixed = f.remediation === Remediation.FixVerified
    const level = d?.level ?? before?.level
    const method = d?.method ?? before?.method
    const clause = clauseOf(f)
    const quote = quoteOf(terms, clause)
    const expected = d?.expected ?? before?.expected ?? '—'
    const ackedByMe = ds.some((x) => x.decision === DecisionType.Acknowledge && x.atCheck === f.lastCheck && same(x.signer, account ?? ''))
    const canAccept = role === 'client' && failing && f.disposition !== Disposition.Accepted
    const canAssign = role === 'reviewer' && failing && (f.remediation === Remediation.None || f.remediation === Remediation.Reopened)
    // Decisions are offered where there is something to decide or record, as before the redesign.
    const hasStory =
      f.verification !== Verification.Pass || f.lastFailedCheck !== 0 || f.remediation !== Remediation.None || f.disposition !== Disposition.Undecided
    const note = notes[f.key] ?? ''
    const status = statusNote(f, shown)
    return (
      <article key={f.key} className="finding">
        <div className="head">
          <Badge tone={KIND_TONE[f.kind]}>{KIND[f.kind].label}</Badge>
          <h3>{clause}</h3>
          <Result result={shown} />
        </div>
        <p className="explain">{explanation(f, shown, before)}</p>
        <div className="compare">
          <div>
            <span className="eyebrow">The agreement says</span>
            <blockquote>{quote ? `“${quote}”` : expected}</blockquote>
            {quote && <span className="method">Term: {expected}</span>}
          </div>
          <div>
            <span className="eyebrow">{fixed && before ? 'The code did → now does' : 'The code does'}</span>
            <code>{fixed && before ? `${before.actual} → ${d?.actual ?? '—'}` : (d?.actual ?? before?.actual ?? '—')}</code>
            {level && <span className="method">Method: {METHOD_SHORT[level]}</span>}
          </div>
        </div>
        <details>
          <summary>View technical details</summary>
          <dl>
            {method && <><dt>How it was checked</dt><dd>{method}</dd></>}
            {f.verification === Verification.Pass && shown === 'inconclusive' && (
              <><dt>Why not Pass</dt><dd>The structure matches, but nothing was executed. The on-chain record says Pass; LexDiff shows it as Inconclusive.</dd></>
            )}
            <dt>Evidence</dt><dd className="mono">{f.evidenceHash}</dd>
            <dt>Details hash</dt><dd className="mono">{f.detailsHash}{d ? ' ✓ matches the report' : ''}</dd>
            <dt>Checks</dt>
            <dd>
              First assessed in #{f.firstCheck}, last in #{f.lastCheck}
              {f.lastFailedCheck ? `, last failed in #${f.lastFailedCheck}` : ''}
              {f.fixVerifiedInCheck ? `, fix recorded in #${f.fixVerifiedInCheck}` : ''}
            </dd>
            {ds.map((x, i) => (
              <span key={i} style={{ display: 'contents' }}>
                <dt>Signature</dt><dd className="mono">{x.signer} · {x.signature.slice(0, 42)}…</dd>
              </span>
            ))}
          </dl>
        </details>
        {(status.length > 0 || ds.length > 0) && (
          <div className="section stack">
            {status.length > 0 && (
              <div className="row" style={{ gap: 6 }}>
                {status.map((x) => <Badge key={x.text} tone={x.tone}>{x.text}</Badge>)}
              </div>
            )}
            {ds.length > 0 && (
              <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>
                {ds.map((x, i) => (
                  <li key={i}>
                    The <b>{roleNames(a, x.signer)}</b> {DECISION_VERB[x.decision]} this · {fmtDate(x.timestamp)}
                    {x.noteHash !== ZERO_BYTES32 && (noteText[x.noteHash] ? <> — “{noteText[x.noteHash]}”</> : <span className="muted"> · 🔒 private note</span>)}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
        {/* Only what this role may sign (LexDiffLogic.applyDecision): fix = lawyer, accept = client, both only on a
            failing property; any party may acknowledge, or dispute with a reason. */}
        {role && hasStory && (
          <div className="actions">
            <span className="small muted" style={{ flex: '1 1 160px' }}>
              {ds.length === 0 ? 'No decision yet' : 'Each signature covers this exact finding.'}
            </span>
            {canAssign && <button className="soft-bad" onClick={() => decide(f, DecisionType.RequireRemediation)} disabled={!!busy}>Developer must fix this</button>}
            {canAccept && <button className="ghost" onClick={() => decide(f, DecisionType.AcceptRisk)} disabled={!!busy}>I accept this risk</button>}
            {!ackedByMe && <button className="link" onClick={() => decide(f, DecisionType.Acknowledge)} disabled={!!busy}>I have seen this</button>}
            <details style={{ flex: '1 1 100%' }}>
              <summary>{canAssign || canAccept ? 'Add a note, or disagree' : 'I disagree with this result'}</summary>
              <div className="stack" style={{ marginTop: 8 }}>
                <input
                  value={note}
                  onChange={(e) => setNotes({ ...notes, [f.key]: e.target.value })}
                  placeholder={canAssign || canAccept ? 'A note goes with the decision you sign' : 'Why you disagree (required)'}
                  aria-label={`Note on ${clause}`}
                />
                <div className="row">
                  <button className="ghost" onClick={() => decide(f, DecisionType.Dispute)} disabled={!!busy || !note.trim()}>
                    Sign my disagreement
                  </button>
                  <span className="small muted">A dispute needs a reason. It is recorded next to the result and changes nothing else.</span>
                </div>
              </div>
            </details>
          </div>
        )}
      </article>
    )
  }

  const parties: { initial: string; name: string; role: string; address: Address; me: boolean }[] = [
    { initial: 'L', name: 'Lawyer', role: 'Lawyer · approved the terms', address: a.reviewer, me: same(account ?? '', a.reviewer) },
    { initial: 'C', name: terms?.parties.client.name ?? 'Client', role: 'Client · funds the escrow', address: a.client, me: same(account ?? '', a.client) },
    {
      initial: 'D',
      name: same(a.developer, a.freelancer) ? (terms?.parties.freelancer.name ?? 'Developer') : 'Developer',
      role: same(a.developer, a.freelancer) ? 'Developer & payee' : 'Developer',
      address: a.developer,
      me: same(account ?? '', a.developer),
    },
    ...(same(a.developer, a.freelancer)
      ? []
      : [{ initial: 'P', name: terms?.parties.freelancer.name ?? 'Payee', role: 'Payee', address: a.freelancer, me: same(account ?? '', a.freelancer) }]),
  ]

  return (
    <>
      <nav aria-label="Breadcrumb" className="crumb">
        <Link href="/">My agreements</Link> / Agreement #{idParam}
      </nav>

      {/* ---- Header ---- */}
      <section className="page-head">
        <div className="stack" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <h1 style={{ margin: 0 }}>{terms?.title ?? 'Agreement'}</h1>
          <div className="row muted" style={{ gap: '6px 10px', marginTop: 0 }}>
            {terms && <span>{terms.parties.client.name} ↔ {terms.parties.freelancer.name}</span>}
            {terms && <span aria-hidden="true">·</span>}
            <span className="mono">{noContract ? 'no contract yet' : `contract ${shortAddr(a.target)}`}</span>
            <span aria-hidden="true">·</span>
            {account ? (
              myRoles.length > 1 ? (
                <span className="segmented" role="group" aria-label="Act as">
                  {myRoles.map((r) => (
                    <button key={r} className={r === role ? 'on' : ''} onClick={() => setActingAs(r)}>{ROLES[r].label}</button>
                  ))}
                </span>
              ) : (
                <Badge tone={role ? 'info' : 'muted'}>{role ? `You are the ${ROLES[role].label.toLowerCase()}` : `${shortAddr(account)} · not a party`}</Badge>
              )
            ) : (
              <button className="ghost small" onClick={connect}>Connect wallet</button>
            )}
          </div>
          {terms && (
            <p className="muted" style={{ margin: 0 }}>
              {terms.parties.client.name} pays <b>{terms.payment.amount} {terms.payment.tokenSymbol}</b> into an escrow contract.{' '}
              {terms.parties.freelancer.name} delivers within <b>{terms.deadlines.deliveryPeriodDays} days</b>.
              {role && <> {ROLES[role].can}</>}
            </p>
          )}
        </div>
      </section>

      {a.supersededBy > BigInt(0) && (
        <p className="notice">This agreement was amended by <Link href={`/agreements/${a.supersededBy}`}>agreement #{a.supersededBy.toString()}</Link>. Its history stays here unchanged.</p>
      )}
      {a.supersedes > BigInt(0) && <p className="notice">Amends <Link href={`/agreements/${a.supersedes}`}>agreement #{a.supersedes.toString()}</Link>.</p>}
      {!terms && <p className="error">The terms are unavailable or do not match the registered fingerprint.</p>}

      {/* ---- Next step: who acts, and the one thing they do ---- */}
      <section aria-labelledby="next-step" className={`next card${stage.waitingFor === null ? ' done' : ''}`}>
        <span className="who">
          {stage.waitingFor === null
            ? 'Done'
            : stage.waitingFor === 'chainlink'
              ? 'Next step · Chainlink'
              : stage.waitingFor === role || (stage.waitingFor === 'reviewer' && role === 'client')
                ? 'Next step · your turn'
                : `Next step · the ${ROLES[stage.waitingFor].label.toLowerCase()}`}
        </span>
        <h2 id="next-step">
          {/* The registry calls a structural result a pass; on screen it is Inconclusive, so the headline says so too. */}
          {stage.waitingFor === null && counts.fail === 0 && counts.inconclusive > 0
            ? `Nothing fails · ${counts.inconclusive} checked in the code only, not executed`
            : stage.title}
        </h2>
        <p style={{ margin: 0 }}>{stage.detail}</p>
        {structuralFixes > 0 && (
          <p className="small" style={{ margin: 0 }}>
            {structuralFixes} of the fixes {structuralFixes === 1 ? 'was' : 'were'} found only in the code and not executed, so they show as
            Inconclusive in the findings.
          </p>
        )}
        {nextAction()}
      </section>

      {error && <p className="error">{error}</p>}
      {busy && <p className="notice" role="status">{busy}…</p>}

      <div role="tablist" aria-label="Agreement" className="tabs" id="tabs">
        {TAB_LIST.map((t) => (
          <button
            key={t.id}
            role="tab"
            id={`tab-${t.id}`}
            aria-selected={tab === t.id}
            aria-controls={`panel-${t.id}`}
            tabIndex={tab === t.id ? 0 : -1}
            onClick={() => openTab(t.id)}
            onKeyDown={onTabKey}
          >
            {t.label}
            {t.count !== undefined && <span className="count">{t.count}</span>}
          </button>
        ))}
      </div>

      {/* ---- Overview ---- */}
      {tab === 'overview' && (
        <div role="tabpanel" id="panel-overview" aria-labelledby="tab-overview" className="columns">
          <div className="primary">
            <section aria-label="Progress" className="progress" style={{ marginBottom: 0 }}>
              <div className="stepper-wrap">
                <ol className="stepper">
                  {STEPS.map((s, i) => (
                    <li key={s} className={i < stage.step || (stage.waitingFor === null && i === stage.step) ? 'done' : i === stage.step ? 'now' : ''} aria-current={i === stage.step ? 'step' : undefined}>
                      <div className="track">
                        <span className="dot">{i < stage.step || (stage.waitingFor === null && i === stage.step) ? '✓' : i + 1}</span>
                        {i < STEPS.length - 1 && <span className="line" />}
                      </div>
                      <span>{s}</span>
                    </li>
                  ))}
                </ol>
              </div>
            </section>

            {checks.length > 0 && (
              <section aria-label="Latest check" className="stack">
                <div className="stats compact">
                  <StatCard label="Pass" icon="pass" color="var(--ok)" value={counts.pass} />
                  <StatCard label="Fail" icon="fail" color="var(--bad)" value={counts.fail} />
                  <StatCard label="Inconclusive" icon="inconclusive" color="var(--warn)" value={counts.inconclusive} />
                  <StatCard label="Not checked" icon="not-checked" value={counts['not-checked']} />
                </div>
                <div className="row spread">
                  <span className="small muted">
                    {lastCheck && <>Contract <span className="mono">{shortAddr(lastCheck.target)}</span> · checked {fmtDate(lastCheck.timestamp)}</>}
                  </span>
                  <button className="ghost small" onClick={() => openTab('findings')}>View all findings</button>
                </div>
              </section>
            )}

            <section aria-labelledby="happened" className="panel">
              <div className="row spread" style={{ alignItems: 'baseline', paddingBottom: 6 }}>
                <h2 id="happened" style={{ margin: 0 }}>What happened</h2>
                <span className="small muted">Append-only · signed, or written by Chainlink</span>
              </div>
              <ol className="timeline">
                {events.map((e, i) => (
                  <li key={i}>
                    <span className="when">{fmtDate(e.t)}</span>
                    <div className="what">
                      <div style={{ fontWeight: 500 }}>{e.text}</div>
                      {e.note && <div className="small">“{e.note}”</div>}
                      <div className="small muted">{e.who}</div>
                    </div>
                    {e.link && <a className="mono" style={{ fontSize: 12 }} href={e.link.href} target="_blank" rel="noreferrer">{e.link.label}</a>}
                  </li>
                ))}
              </ol>
            </section>
          </div>

          <aside>
          <section aria-labelledby="parties" className="panel stack">
            <h2 id="parties">Parties</h2>
            {parties.map((p) => (
              <div key={p.initial} className={`party${p.me ? ' me' : ''}`}>
                <span className="avatar" aria-hidden="true">{p.initial}</span>
                <div>
                  <div style={{ fontWeight: 500 }}>{p.name}</div>
                  <div className="role">{p.role}{p.me ? ' · you' : ''}</div>
                </div>
                <a className="mono muted" style={{ fontSize: 12 }} href={`${EXPLORER}/address/${p.address}`} target="_blank" rel="noreferrer">{shortAddr(p.address)}</a>
              </div>
            ))}
          </section>

          <section aria-labelledby="money" className="panel stack">
            <h2 id="money">Where the money is</h2>
            {operational ? (
              <>
                <div className="row" style={{ alignItems: 'baseline', gap: 8 }}>
                  <span className="big-number">{fmtAmount(operational.targetBalance, terms).split(' ')[0]}</span>
                  <span className="muted">of {fmtAmount(operational.expectedAmount, terms)} deposited</span>
                </div>
                {BigInt(operational.targetBalance) >= BigInt(operational.expectedAmount) && BigInt(operational.expectedAmount) > BigInt(0)
                  ? <Badge tone="ok">Funded</Badge>
                  : <p className="small muted" style={{ margin: 0 }}>Not funded yet. The client decides whether to fund it once every failing property is fixed or decided.</p>}
                {operational.previousTarget && operational.previousBalance !== null && BigInt(operational.previousBalance) > BigInt(0) && (
                  <p className="error small" style={{ margin: 0 }}>
                    The previous contract {shortAddr(operational.previousTarget)} still holds {fmtAmount(operational.previousBalance, terms)}.
                    Choosing the new contract did not move these funds.
                  </p>
                )}
                <span className="small muted">Read from Sepolia by Chainlink in the latest check.</span>
              </>
            ) : (
              <p className="small muted" style={{ margin: 0 }}>
                {noContract ? 'No contract yet, so nothing can be deposited.' : 'Shown after the first Chainlink check.'}
              </p>
            )}
          </section>

          <section aria-labelledby="contracts" className="panel stack">
            <h2 id="contracts">Escrow contract</h2>
            {history.map((h, i) => {
              const current = i === history.length - 1
              return (
                <div key={i} className="row" style={{ gap: 8 }}>
                  <div style={{ flex: '1 1 160px' }}>
                    <div style={{ fontWeight: 500 }}>V{i + 1} · {current ? 'chosen by the client' : 'replaced'}</div>
                    <a className="mono" style={{ fontSize: 12 }} href={`${EXPLORER}/address/${h}#code`} target="_blank" rel="noreferrer">{shortAddr(h)} ↗</a>
                  </div>
                  {current && <Badge tone={checks.some((c) => same(c.target, h)) ? 'info' : 'muted'}>{checks.some((c) => same(c.target, h)) ? 'Checked' : 'Waiting for Chainlink'}</Badge>}
                </div>
              )
            })}
            {pending && (
              <div className="row" style={{ gap: 8 }}>
                <div style={{ flex: '1 1 160px' }}>
                  <div style={{ fontWeight: 500 }}>V{history.length + 1} · proposed by developer</div>
                  <a className="mono" style={{ fontSize: 12 }} href={`${EXPLORER}/address/${a.pendingTarget}#code`} target="_blank" rel="noreferrer">{shortAddr(a.pendingTarget)} ↗</a>
                </div>
                <Badge tone="muted">Waiting for client</Badge>
              </div>
            )}
            {noContract && !pending && <p className="small muted" style={{ margin: 0 }}>None yet. The developer proposes it after the agreement is signed.</p>}
            <p className="small muted" style={{ margin: 0 }}>LexDiff stores fingerprints (hashes) of the agreement, terms, findings and signatures. It never touches the money.</p>
          </section>

          <section aria-labelledby="document" className="panel stack">
            <h2 id="document">Signed agreement</h2>
            {agreementDoc ? (
              <details>
                <summary>Read the full agreement</summary>
                <pre style={{ whiteSpace: 'pre-wrap' }}>{agreementDoc.text}</pre>
              </details>
            ) : myRoles.length > 0 && !storedAccess(account) ? (
              <>
                <button className="ghost" disabled={!!busy} onClick={() => run('Unlocking the private documents', async () => void (await unlockAccess()))}>
                  🔒 Show the signed agreement and notes
                </button>
                <span className="small muted">Private to the parties. Your wallet signs a read pass (no transaction, valid for 24 hours).</span>
              </>
            ) : (
              <p className="small muted" style={{ margin: 0 }}>🔒 The signed agreement and decision notes are private to the parties.</p>
            )}
          </section>

          </aside>
        </div>
      )}

      {/* ---- Findings ---- */}
      {tab === 'findings' && (
        <section role="tabpanel" id="panel-findings" aria-labelledby="tab-findings" className="stack">
          <div>
            <h2 style={{ margin: '0 0 4px', fontSize: 26 }}>What Chainlink found</h2>
            <p className="small muted" style={{ margin: 0 }}>
              {lastCheck ? (
                <>Contract <span className="mono">{shortAddr(lastCheck.target)}</span> · checked {fmtDate(lastCheck.timestamp)} by the agreement&apos;s own Chainlink CRE verifier</>
              ) : noContract ? 'Nothing to check yet: the developer has not proposed a contract.' : 'The contract has not been checked yet.'}
            </p>
          </div>
          {checks.length === 0 ? (
            <EmptyState title="Not checked yet">
              {noContract
                ? 'Once the developer proposes the contract and the client sends it for checking, Chainlink compares it with every term.'
                : 'Chainlink compares the contract with every term. Results appear here.'}
            </EmptyState>
          ) : (
            <>
              <div className="stats compact">
                <StatCard label="Pass" icon="pass" color="var(--ok)" value={counts.pass} />
                <StatCard label="Fail" icon="fail" color="var(--bad)" value={counts.fail} />
                <StatCard label="Inconclusive" icon="inconclusive" color="var(--warn)" value={counts.inconclusive} />
                <StatCard label="Not checked" icon="not-checked" value={counts['not-checked']} />
              </div>

              {coverage && (
                <details className="panel small">
                  <summary>
                    What was checked: {coverage.checked} terms, {coverage.byLevel.value} read from the live contract, {coverage.byLevel.structural} from
                    the source code only{coverage.unchecked.length > 0 ? ` · ${coverage.unchecked.length} need a human` : ''}
                  </summary>
                  <p style={{ margin: '10px 0 0' }}>
                    A result from the source code means the code has the right shape. Nothing was executed, so it shows as Inconclusive, never Pass.
                  </p>
                  {coverage.unchecked.length > 0 ? (
                    <ul style={{ margin: '8px 0 0', paddingLeft: 18 }}>
                      {coverage.unchecked.map((u, i) => (
                        <li key={i}>
                          <Badge tone="muted">{u.term}</Badge> {u.text} <span className="muted">· {u.reason}</span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p style={{ margin: '8px 0 0' }}>Every term in the agreement was checked.</p>
                  )}
                </details>
              )}

              <div role="group" aria-label="Filter findings" className="filters">
                {FILTERS.filter((x) => x.id === 'all' || x.n > 0 || x.id === filter).map((x) => (
                  <button key={x.id} aria-pressed={filter === x.id} onClick={() => setFilter(x.id)}>
                    {x.label} · {x.n}
                  </button>
                ))}
              </div>

              {visible.length === 0 ? (
                <EmptyState title="Nothing matches this filter">
                  <button className="link" style={{ padding: 0, minHeight: 0 }} onClick={() => setFilter('all')}>Show all findings</button>
                </EmptyState>
              ) : (
                visible.map(findingCard)
              )}
            </>
          )}

        </section>
      )}

      {/* ---- Evidence ---- */}
      {tab === 'evidence' && (
        <div role="tabpanel" id="panel-evidence" aria-labelledby="tab-evidence" className="columns">
          <div className="primary">
            <section aria-labelledby="export" className="panel stack">
              <h2 id="export">Case record</h2>
              <p className="small muted" style={{ margin: 0 }}>
                One file with the agreement, terms, reports, findings, signed decisions and transactions. Every hash in it can be
                checked against Sepolia, without trusting LexDiff.
              </p>
              <div className="row">
                <button onClick={downloadRecord}>Export case record</button>
              </div>
            </section>

            <section aria-labelledby="trail" className="panel">
              <h2 id="trail">Sepolia transaction trail</h2>
              <ol className="timeline">
                {chainEvents.map((event, index) => (
                  <li key={`${event.transactionHash}-${index}`}>
                    <span className="when">block {event.blockNumber.toString()}</span>
                    <span className="what" style={{ fontWeight: 500 }}>{event.eventName}</span>
                    <a className="mono" style={{ fontSize: 12 }} href={`${EXPLORER}/tx/${event.transactionHash}`} target="_blank" rel="noreferrer">
                      tx {event.transactionHash.slice(0, 6)}…{event.transactionHash.slice(-4)}
                    </a>
                  </li>
                ))}
              </ol>
              <p className="small muted" style={{ margin: '8px 0 0' }}>Every entry is on Sepolia and cannot be edited afterwards.</p>
            </section>

            <section aria-labelledby="checker" className="panel stack">
              <h2 id="checker">Chainlink checks</h2>
              <p className="small muted" style={{ margin: 0 }}>
                The Chainlink CRE workflow answers every check request on its own. A party can ask for a new check at any time.
              </p>
              {canRequestCheck && (
                <div className="row">
                  <button
                    className="ghost"
                    disabled={!!busy}
                    onClick={() => run('Requesting a Chainlink check on Sepolia', async () => void (await writeRegistry('requestCheck', [id])))}
                  >
                    Ask Chainlink to check again
                  </button>
                </div>
              )}
              {log && (
                <details open={!!busy}>
                  <summary>Chainlink CRE log</summary>
                  <pre className="log">{log}</pre>
                </details>
              )}
              <details>
                <summary>Running the checker yourself (simulation)</summary>
                <p className="small">
                  In this demo the workflow runs through the CRE CLI simulator. Keep <code>node watch.ts</code> running in{' '}
                  <code>cre/lexdiff-workflow</code> and it answers every request automatically.{' '}
                  {localCre ? 'This install can also run one check directly:' : 'To run one check yourself, use the CRE CLI:'}
                </p>
                {localCre && (
                  <div className="row">
                    <button onClick={runCheck} disabled={!!busy}>Run the check on this machine</button>
                  </div>
                )}
                <pre>{simulateCmd}</pre>
              </details>
            </section>
          </div>

          <aside>
            <section aria-labelledby="verifier" className="panel subtle stack">
              <h2 id="verifier" style={{ fontFamily: 'inherit', fontSize: 14 }}>Independent verifier</h2>
              <p className="small" style={{ margin: 0, color: 'var(--ink-soft)' }}>
                Chainlink CRE workflow, pinned at registration. Chosen and signed by the parties. Nobody can change it.
              </p>
              <div className="row" style={{ gap: 8 }}>
                <span className="mono muted" style={{ fontSize: 12 }}>forwarder {shortAddr(a.verifier.forwarder)}</span>
                {isMock ? <Badge tone="warn">Simulation</Badge> : <Badge tone="ok">Production</Badge>}
              </div>
            </section>

            <section aria-labelledby="fingerprints" className="panel stack">
              <h2 id="fingerprints">Fingerprints</h2>
              <p className="small muted" style={{ margin: 0 }}>Only these hashes are on-chain. The documents they fingerprint stay off-chain.</p>
              <div className="evidence stack" style={{ marginTop: 8 }}>
                <div>Agreement document {a.agreementHash} {agreementDoc ? '✓' : ''}</div>
                <div>Terms {a.termsHash} · <a href={a.termsURI} target="_blank" rel="noreferrer">terms</a></div>
                {checks.map((c, i) => <div key={i}>Check #{i + 1}: source {c.codeHash} · report {c.reportHash}</div>)}
              </div>
            </section>
          </aside>
        </div>
      )}
    </>
  )
}
