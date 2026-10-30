'use client'

import { useState } from 'react'
import { Loading, Result, StatCard } from '@/components/ui'
import { RPC_URL } from '@/lib/registry'
import { type Assertion, verifyRecord } from '@/lib/verify'

// Icon and word for each outcome, reusing the verification result icons.
const SHOWN = { valid: 'pass', invalid: 'fail', unknown: 'inconclusive' } as const
const LABEL = { valid: 'Integrity valid', invalid: 'Integrity invalid', unknown: 'Unable to verify' } as const
const COLOR = { valid: 'var(--ok)', invalid: 'var(--bad)', unknown: 'var(--warn)' } as const

export default function VerifyPage() {
  const [rpc, setRpc] = useState(RPC_URL)
  const [results, setResults] = useState<Assertion[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const onFile = async (file: File | undefined) => {
    if (!file) return
    setBusy(true)
    setError('')
    setResults(null)
    try {
      setResults(await verifyRecord(JSON.parse(await file.text()), rpc))
    } catch (e) {
      setError(`Could not read the file: ${(e as Error).message}`)
    } finally {
      setBusy(false)
    }
  }

  const count = (r: Assertion['result']) => results?.filter((a) => a.result === r).length ?? 0
  const groups = results ? [...new Set(results.map((a) => a.group))] : []

  return (
    <>
      <section className="page-head">
        <div>
          <h1>Verify a case record</h1>
          <p className="lede" style={{ margin: 0 }}>
            Upload a record exported from an agreement page (<i>Export case record</i>). Everything is checked in your browser
            against the file and the public Sepolia blockchain. Nothing is fetched from LexDiff&apos;s own server, so you do not
            have to trust us.
          </p>
        </div>
      </section>

      <section className="panel stack">
        <div>
          <label>Case record (.json)</label>
          <input type="file" accept="application/json,.json" onChange={(e) => onFile(e.target.files?.[0])} disabled={busy} />
        </div>
        <details>
          <summary>Blockchain node</summary>
          <input className="mono" value={rpc} onChange={(e) => setRpc(e.target.value)} />
          <p className="small muted">Any Sepolia RPC endpoint works. Use your own node for full independence.</p>
        </details>
      </section>

      {busy && <div style={{ marginTop: 16 }}><Loading label="Checking against Sepolia…" /></div>}
      {error && <p className="error">{error}</p>}

      {results && (
        <>
          <div className="stats" style={{ margin: '16px 0' }}>
            {(['valid', 'invalid', 'unknown'] as const).map((r) => (
              <StatCard key={r} label={LABEL[r]} icon={SHOWN[r]} color={COLOR[r]} value={count(r)} />
            ))}
          </div>
          {groups.map((g) => (
            <section key={g} style={{ marginTop: '1rem' }}>
              <h2 style={{ marginTop: 0, fontSize: 20 }}>{g}</h2>
              <div className="panel table-wrap" style={{ padding: 0 }}>
                <table>
                  <tbody>
                    {results.filter((a) => a.group === g).map((a, i) => (
                      <tr key={i}>
                        <td style={{ width: 180 }}><Result result={SHOWN[a.result]}>{LABEL[a.result]}</Result></td>
                        <td><b>{a.claim}</b>{a.detail && <div className="small muted">{a.detail}</div>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ))}
          <p className="small muted" style={{ marginTop: '1.5rem' }}>
            This checks integrity only: that the documents, findings, decisions and transactions are the ones recorded on Sepolia
            and were not altered. It does not say the agreement is legally valid, that the contract is compliant, or who is
            liable. A wallet signature proves control of a key, not a person&apos;s identity or authority.
          </p>
        </>
      )}
    </>
  )
}
