import { createPublicClient, http, isAddress, keccak256, toBytes, type Address, type Hex } from 'viem'
import { sepolia } from 'viem/chains'
import { registryAbi } from './registry-abi'
import type { Agreement, Check, Decision, Finding, ReportDocument } from './registry'
import { canonicalize } from './terms'

// Independent verification of an exported case record (F07).
// Uses only the uploaded file and a public RPC node: nothing from LexDiff's own server is trusted.
// It checks integrity (hashes, on-chain state, transactions). It never concludes legal validity or compliance.

export type Result = 'valid' | 'invalid' | 'unknown'
export type Assertion = { group: string; claim: string; result: Result; detail: string }

type Json = Record<string, any>

const ZERO = `0x${'0'.repeat(64)}`
const eq = (a: unknown, b: unknown) => String(a).toLowerCase() === String(b).toLowerCase()
const hashOf = (value: unknown) => keccak256(toBytes(canonicalize(value)))

export async function verifyRecord(record: Json, rpcUrl: string): Promise<Assertion[]> {
  const out: Assertion[] = []
  const add = (group: string, claim: string, result: Result, detail = '') => out.push({ group, claim, result, detail })

  // --- The file itself --------------------------------------------------
  if (typeof record?.schema !== 'string' || !record.schema.startsWith('lexdiff/case-record@')) {
    add('File', 'This is a LexDiff case record', 'invalid', `schema: ${record?.schema ?? 'missing'}`)
    return out
  }
  add('File', 'This is a LexDiff case record', 'valid', record.schema)
  const registry = record.registry as Address
  const id = BigInt(record.agreementId)
  const documents: Record<string, unknown> = record.documents ?? {}
  if (!isAddress(registry ?? '')) {
    add('File', 'The record names the registry contract', 'invalid', String(registry))
    return out
  }
  if (!record.documents) {
    add('File', 'The record includes its evidence documents', 'unknown', 'Exported before documents were included (case-record@1)')
  }

  const client = createPublicClient({ chain: sepolia, transport: http(rpcUrl) })
  const read = <T>(functionName: string, args: readonly unknown[]) =>
    client.readContract({ address: registry, abi: registryAbi, functionName, args } as never) as Promise<T>

  try {
    const chainId = await client.getChainId()
    add('Chain', `Connected to chain ${record.chainId}`, chainId === Number(record.chainId) ? 'valid' : 'invalid', `RPC reports chain ${chainId}`)
    const code = await client.getCode({ address: registry })
    add('Chain', 'The registry contract exists at the stated address', code && code !== '0x' ? 'valid' : 'invalid', registry)
  } catch (e) {
    add('Chain', 'Reach the blockchain', 'unknown', String((e as Error).message ?? e))
    return out
  }

  // --- Documents: do they hash to what they claim? ------------------------
  for (const [hash, value] of Object.entries(documents)) {
    const ok = hashOf(value) === hash
    add('Documents', `Document ${hash.slice(0, 10)}… is unmodified`, ok ? 'valid' : 'invalid', ok ? 'Re-hashed locally' : `Re-hashes to ${hashOf(value)}`)
  }
  const doc = <T>(hash: string): { value: T | null; result: Result } => {
    if (!(hash in documents)) return { value: null, result: 'unknown' }
    return hashOf(documents[hash]) === hash ? { value: documents[hash] as T, result: 'valid' } : { value: null, result: 'invalid' }
  }

  // --- Agreement ----------------------------------------------------------
  let agreement: Agreement
  try {
    agreement = await read<Agreement>('getAgreement', [id])
  } catch (e) {
    add('Agreement', `Agreement #${id} exists in the registry`, 'invalid', String((e as Error).message ?? e))
    return out
  }
  const ra = record.agreement ?? {}
  const sameAgreement = (['client', 'reviewer', 'developer', 'freelancer', 'target', 'agreementHash', 'termsHash'] as const).every((k) => eq(agreement[k], ra[k]))
  add('Agreement', 'Parties, contract and terms fingerprint match the registry', sameAgreement ? 'valid' : 'invalid',
    sameAgreement ? `Terms fingerprint ${agreement.termsHash}` : 'The export differs from the on-chain agreement')
  if ('agreementHash' in agreement) {
    const full = doc((agreement as Agreement & { agreementHash: string }).agreementHash)
    add('Agreement', 'The full agreement document is the one that was signed', full.result,
      full.result === 'valid' ? 'Hashes to the registered fingerprint' : full.result === 'unknown' ? 'Document not included in the export' : 'Document was modified')
  }
  const terms = doc(agreement.termsHash)
  add('Agreement', 'The terms document is the one the reviewer and client signed', terms.result,
    terms.result === 'valid' ? 'Hashes to the registered fingerprint' : terms.result === 'unknown' ? 'Terms not included in the export' : 'Terms were modified')

  // --- Checks -------------------------------------------------------------
  const checks = await read<Check[]>('getChecks', [id])
  const rc: Json[] = record.checks ?? []
  add('Checks', `${checks.length} Chainlink check(s) recorded`, checks.length === rc.length ? 'valid' : 'invalid',
    checks.length === rc.length ? '' : `Export lists ${rc.length}`)
  const reportByHash: Record<string, ReportDocument> = {}
  checks.forEach((c, i) => {
    const same = eq(c.reportHash, rc[i]?.reportHash) && eq(c.codeHash, rc[i]?.codeHash) && eq(c.target, rc[i]?.target)
    const report = doc<ReportDocument>(c.reportHash)
    if (report.value) reportByHash[c.reportHash] = report.value
    const result: Result = !same ? 'invalid' : report.result
    add('Checks', `Check #${i + 1}: report matches what Chainlink anchored`, result,
      !same ? 'The export differs from the on-chain check' : report.result === 'valid'
        ? `Contract ${c.target}, source hash ${c.codeHash.slice(0, 10)}…`
        : report.result === 'unknown' ? 'Report document not included' : 'Report document was modified')
  })

  // --- Findings -----------------------------------------------------------
  const findings = await read<Finding[]>('getFindings', [id])
  const rf: Json[] = record.findings ?? []
  const allReported = Object.values(reportByHash).flatMap((r) => r.findings)
  for (const f of findings) {
    const exported = rf.find((x) => eq(x.key, f.key))
    const same =
      !!exported &&
      eq(exported.kind, f.kind) &&
      eq(exported.verification, f.verification) &&
      eq(exported.remediation, f.remediation) &&
      eq(exported.disposition, f.disposition) &&
      eq(exported.evidenceHash, f.evidenceHash)
    let result: Result = same ? 'valid' : 'invalid'
    let label = f.key.slice(0, 10) + '…'
    let detail = same ? '' : 'Status or evidence differs from the chain'
    if (same && f.detailsHash !== ZERO) {
      const d = allReported.find((x) => eq(x.detailsHash, f.detailsHash))
      if (!d) {
        result = 'unknown'
        detail = 'Human-readable details not included'
      } else if (hashOf({ clause: d.clause, expected: d.expected, actual: d.actual }) !== f.detailsHash) {
        result = 'invalid'
        detail = 'Details do not hash to the on-chain value'
      } else {
        label = d.clause
        detail = `Agreement: ${d.expected} · Code: ${d.actual}`
      }
    }
    add('Findings', `Finding "${label}" matches the chain`, result, detail)

    // --- Decisions on this finding ----------------------------------------
    const decisions = await read<Decision[]>('getDecisions', [id, f.key])
    const rd: Json[] = record.decisions?.[f.key] ?? []
    decisions.forEach((d, i) => {
      const e = rd[i]
      const same = !!e && eq(e.signer, d.signer) && eq(e.signature, d.signature) && eq(e.evidenceHash, d.evidenceHash)
      const note = d.noteHash === ZERO ? null : doc<{ note: string }>(d.noteHash)
      const result: Result = !same ? 'invalid' : note && note.result !== 'valid' ? note.result : 'valid'
      add('Decisions', `Decision by ${d.signer.slice(0, 8)}… on "${label}"`, result,
        !same ? 'The export differs from the on-chain decision'
          : `Stored only after the registry verified the EIP-712 signature over evidence ${d.evidenceHash.slice(0, 10)}…` +
            (note?.value ? ` · note: “${note.value.note}”` : note ? ' · note not included' : ''))
    })
  }

  // --- Transactions -------------------------------------------------------
  const events: Json[] = record.events ?? []
  await Promise.all(
    events.map(async (ev) => {
      try {
        const receipt = await client.getTransactionReceipt({ hash: ev.transactionHash as Hex })
        const fromRegistry = receipt.logs.some((l) => eq(l.address, registry))
        add('Transactions', `${ev.eventName} in tx ${String(ev.transactionHash).slice(0, 10)}…`,
          receipt.status === 'success' && fromRegistry ? 'valid' : 'invalid',
          `Block ${receipt.blockNumber}${receipt.status === 'success' ? '' : ' · reverted'}`)
      } catch (e) {
        add('Transactions', `${ev.eventName} in tx ${String(ev.transactionHash).slice(0, 10)}…`, 'unknown', 'Not found via this RPC')
      }
    }),
  )

  return out
}
