'use client'

import { useEffect, useState } from 'react'
import { isAddress } from 'viem'
import { EXPLORER, same, shortAddr } from '@/lib/registry'

type Demo = { escrowV1: string | null; escrowV2: string | null; websiteEscrow: string | null }
type Info = { isContract: boolean; verified: boolean | null; name: string | null }

const DEMOS: { key: keyof Demo; label: string; hint: string }[] = [
  { key: 'escrowV1', label: 'Freelance escrow V1', hint: 'Demo: deadline 3 days, no refund, owner can withdraw' },
  { key: 'escrowV2', label: 'Freelance escrow V2', hint: 'Demo: the corrected version (30 days, refund added)' },
  { key: 'websiteEscrow', label: 'Website redesign escrow', hint: 'Second demo: review period 2 days, extra admin power' },
]

/** Pick a published demo contract or paste any Sepolia address; checks it exists and is verified. */
export default function ContractPicker({ value, onChange }: { value: string; onChange: (address: string) => void }) {
  const [demo, setDemo] = useState<Demo | null>(null)
  const [info, setInfo] = useState<Info | null>(null)

  useEffect(() => {
    fetch('/api/demo').then((r) => r.json()).then(setDemo).catch(() => {})
  }, [])

  useEffect(() => {
    setInfo(null)
    if (!isAddress(value)) return
    const ctrl = new AbortController()
    fetch(`/api/contract-info?address=${value}`, { signal: ctrl.signal })
      .then((r) => r.json())
      .then(setInfo)
      .catch(() => {})
    return () => ctrl.abort()
  }, [value])

  const options = DEMOS.filter((d) => demo?.[d.key])
  const custom = !options.some((d) => same(demo?.[d.key] ?? '', value))

  return (
    <div className="stack">
      <div className="grid two">
        {options.map((d) => {
          const address = demo![d.key]!
          const selected = same(address, value)
          return (
            <button
              key={d.key}
              type="button"
              className="ghost option"
              aria-pressed={selected}
              onClick={() => onChange(address)}
            >
              <span>{d.label}</span>
              <span className="small muted" style={{ fontWeight: 400 }}>{d.hint} · <span className="mono">{shortAddr(address)}</span></span>
            </button>
          )
        })}
      </div>
      <input
        className="mono"
        value={custom ? value : ''}
        onChange={(e) => onChange(e.target.value.trim())}
        placeholder="…or paste any contract address on Sepolia (0x…)"
      />
      {value && !isAddress(value) && <span className="small error">That is not a valid address.</span>}
      {isAddress(value) && !info && <span className="small muted">Checking the contract on Sepolia…</span>}
      {info && (
        <span className="small">
          {!info.isContract ? (
            <span className="error">No contract at this address on Sepolia.</span>
          ) : info.verified === false ? (
            <span className="error">This contract is not verified on Etherscan, so Chainlink cannot read its source.</span>
          ) : (
            <>
              ✓ {info.name ?? 'Contract'} on Sepolia{info.verified ? ', source verified' : ''} ·{' '}
              <a href={`${EXPLORER}/address/${value}#code`} target="_blank" rel="noreferrer">view code</a>
            </>
          )}
        </span>
      )}
    </div>
  )
}
