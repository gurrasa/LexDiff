/** Conservative, source-indexed, printable derivative of the complete JSON case snapshot.
 * This is NOT a legal opinion, privileged disclosure system or a server-audited export.
 */
import { keccak256, toBytes } from 'viem'
import { canonicalize } from './terms'

type RecordObject = Record<string, unknown>
const obj = (value: unknown): RecordObject => value && typeof value === 'object' && !Array.isArray(value) ? value as RecordObject : {}
const arr = (value: unknown): unknown[] => Array.isArray(value) ? value : []
const str = (value: unknown): string => value == null ? 'Not recorded' : String(value)
const escapeHtml = (v: unknown): string => str(v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)
const hash = (value: unknown) => keccak256(toBytes(canonicalize(value)))
const short = (value: unknown) => str(value).slice(0, 18) + '…'
const row = (...cells: unknown[]) => `<tr>${cells.map(v => `<td>${escapeHtml(v)}</td>`).join('')}</tr>`
const section = (title: string, body: string) => `<section><h2>${escapeHtml(title)}</h2>${body}</section>`
const table = (heads: string[], content: string) => `<table><thead><tr>${heads.map(v => `<th>${escapeHtml(v)}</th>`).join('')}</tr></thead><tbody>${content}</tbody></table>`

export function verifyCaseSnapshot(record: RecordObject) {
  const agreement = obj(record.agreement)
  const documents = obj(record.documents)
  const checks = arr(record.checks).map(obj)
  const findings = arr(record.findings).map(obj)
  const decisions = obj(record.decisions)
  const expected = new Set<string>([str(agreement.agreementHash), str(agreement.termsHash), ...checks.map(c => str(c.reportHash))])
  for (const ds of Object.values(decisions)) for (const d of arr(ds)) {
    const note = str(obj(d).noteHash)
    if (/^0x[0-9a-f]{64}$/i.test(note) && !/^0x0{64}$/i.test(note)) expected.add(note)
  }
  const warnings: string[] = []
  const index = [...expected].map(id => {
    const value = documents[id]
    if (value === undefined) { warnings.push(`Missing original evidence: ${id}`); return { id, status: 'Missing' } }
    const status = hash(value).toLowerCase() === id.toLowerCase() ? 'Hash matches' : 'HASH MISMATCH'
    if (status !== 'Hash matches') warnings.push(`Tampered or noncanonical evidence: ${id}`)
    return { id, status }
  })
  if (checks.length === 0) warnings.push('No CRE verification runs recorded')
  if (findings.length === 0) warnings.push('No recorded findings; do not infer all contractual properties were checked')
  if (!record.events || !Array.isArray(record.events)) warnings.push('Transaction chronology unavailable')
  if (arr(record.contractHistory).length > 1) warnings.push('Target has been replaced; operational migration of funds is NOT established')
  const unresolved = findings.filter(f => Number(f.verification) !== 1 || Number(f.remediation) !== 0 || Number(f.disposition) !== 0)
  if (unresolved.length) warnings.push(`${unresolved.length} findings are adverse, unchecked, or subject to disposition/remediation; inspect the complete findings register`)
  return { index, warnings, unresolvedCount: unresolved.length, checksCount: checks.length, findingsCount: findings.length, sourceHash: hash(record) }
}

/** HTML suitable for the browser Print → Save as PDF workflow. All source strings are escaped. */
export function renderLegalCaseRecord(record: RecordObject): string {
  if (record.schema !== 'lexdiff/case-record@3') throw new Error('Unsupported case record schema')
  const a = obj(record.agreement)
  const checks = arr(record.checks).map(obj)
  const findings = arr(record.findings).map(obj)
  const decisions = obj(record.decisions)
  const events = arr(record.events).map(obj)
  const documents = obj(record.documents)
  const manifest = verifyCaseSnapshot(record)
  const required = [a.client, a.freelancer, a.reviewer, a.developer]
  const warnings = manifest.warnings.map(w => `<li>${escapeHtml(w)}</li>`).join('') || '<li>No snapshot-local integrity warnings. This does not verify legal accuracy or blockchain completeness.</li>'
  const roleRows = ['Client', 'Freelancer / counterparty', 'Reviewer', 'Developer'].map((role, i) => row(role, required[i], 'Identity, capacity and authority NOT independently established')).join('')
  const firstDoc = obj(documents[str(a.agreementHash)])
  const fullText = typeof firstDoc.text === 'string' ? firstDoc.text : 'Original document missing from snapshot; see evidence index.'
  const termDoc = obj(documents[str(a.termsHash)])
  const clauses = arr(termDoc.sourceClauses).map(obj)
  const clauseRows = clauses.map((c, i) => row(i + 1, c.term, c.quote, 'Reviewed interpretation/coverage not independently established')).join('')
  const findingRows = findings.map((f, i) => {
    const reportFindings = checks.flatMap(c => arr(obj(documents[str(c.reportHash)]).findings).map(obj))
    const detail = reportFindings.find(d => d.key === f.key && d.detailsHash === f.detailsHash) ?? {}
    return row(i + 1, f.key, detail.clause ?? 'Source clause unavailable', detail.expected ?? 'Unspecified', detail.actual ?? 'Not evidenced in included report', `Verification ${str(f.verification)} / remediation ${str(f.remediation)} / disposition ${str(f.disposition)}`, f.evidenceHash)
  }).join('')
  const checksRows = checks.map((c, i) => row(i + 1, c.timestamp, c.target, c.codeHash, c.reportHash, `${str(c.passed)} pass / ${str(c.failed)} fail / ${str(c.inconclusive)} inconclusive`, 'Method limited to reported checks; production workflow authentication not independently verified')).join('')
  const decisionRows = Object.entries(decisions).flatMap(([key, ds]) => arr(ds).map(d => {
    const x = obj(d); return row(key, x.timestamp, x.signer, x.decision, x.evidenceHash, x.noteHash, 'Signed position; NOT an admission, amendment, waiver or legal determination')
  })).join('')
  const eventRows = events.map(e => row(e.blockNumber, e.eventName, e.transactionHash, 'Blockchain event; meaning is limited to the on-chain record')).join('')
  const cover = `<header><p>LexDiff | Legal Case Record — printable derivative</p><h1>Agreement ${escapeHtml(record.agreementId)}</h1><p>Snapshot exported: ${escapeHtml(record.exportedAt)}</p><p>Snapshot fingerprint: <code>${escapeHtml(manifest.sourceHash)}</code></p><p>Chain ${escapeHtml(record.chainId)} • registry ${escapeHtml(record.registry)}</p><p><strong>Not a determination of breach, causation, damages, liability or legal compliance.</strong></p><p><strong>Disclosure:</strong> complete unredacted local derivative intended only for authorised internal review. Do not forward to external recipients without lawful disclosure review.</p></header>`
  const html = cover +
    section('A. Executive summary and outstanding risks', `<p>${manifest.checksCount} recorded checks; ${manifest.findingsCount} current findings; ${manifest.unresolvedCount} potentially adverse/unresolved findings. These are technical observations, not legal conclusions.</p><ul>${warnings}</ul>`) +
    section('B. Parties, roles and authority', table(['Role', 'Wallet', 'Authority qualification'], roleRows)) +
    section('C. Agreement and cited clauses', `<p>Full document hash: ${escapeHtml(a.agreementHash)}; structured terms hash: ${escapeHtml(a.termsHash)}.</p>${table(['#', 'Requirement', 'Verbatim quote', 'Coverage qualification'], clauseRows)}<details><summary>Full original document (if included)</summary><pre>${escapeHtml(fullText)}</pre></details>`) +
    section('D. On-chain target and verification methods', `<p>Current reported target ${escapeHtml(a.target)}. No inferred operational migration or funding.</p>${table(['Check', 'Timestamp', 'Target', 'Code hash', 'Report hash', 'Counts', 'Scope qualification'], checksRows)}`) +
    section('E. Complete technical findings register', table(['#', 'Finding key', 'Clause', 'Expected', 'Observed', 'Recorded states', 'Evidence'], findingRows)) +
    section('F. On-chain chronology', table(['Block', 'Event', 'Transaction', 'Qualification'], eventRows)) +
    section('G. Decisions, dispute and remediation history', table(['Finding', 'Timestamp', 'Signer', 'Decision code', 'Signed evidence', 'Note hash', 'Qualification'], decisionRows)) +
    section('H. Outstanding matters and limitations', `<ul>${warnings}</ul><p>Absence of a finding does not mean a term passed. A structural observation does not prove behavior. Funded migration, identity, authority, dispute resolution and prior losses require independent evidence.</p>`) +
    section('I. Evidence index and frozen snapshot manifest', `<p>Source JSON fingerprint (Keccak-256 of canonical snapshot): <code>${escapeHtml(manifest.sourceHash)}</code></p>${table(['Evidence hash', 'Local integrity status'], manifest.index.map(x => row(x.id, x.status)).join(''))}<p>This manifest verifies snapshot-local bytes only. Recheck the JSON against Sepolia using LexDiff /verify; no blockchain query was made during PDF rendering.</p>`)
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>LexDiff Legal Case Record</title><style>@page{size:A4;margin:16mm}body{font:11px/1.5 system-ui,Arial;color:#17202b;max-width:900px;margin:35px auto}header{border-bottom:3px solid #253c5d;padding-bottom:16px}h1{font-size:26px}h2{font-size:16px;border-bottom:1px solid #aaa;padding-bottom:6px}section{break-inside:auto;margin-top:22px}table{border-collapse:collapse;width:100%;font-size:9px;table-layout:fixed}td,th{padding:6px;border:1px solid #ccc;overflow-wrap:anywhere;text-align:left;vertical-align:top}th{background:#eef1f6}tr{break-inside:avoid}pre{white-space:pre-wrap;overflow-wrap:anywhere}code{overflow-wrap:anywhere}details{margin-top:12px}ul{padding-left:20px} @media print{body{margin:0}details{display:block}details>*{display:block}}</style></head><body>${html}</body></html>`
}
