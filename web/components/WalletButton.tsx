'use client'

import { useEffect, useState } from 'react'
import type { Address } from 'viem'
import { activePersona, type Persona, PERSONA_LABEL, personas, setPersona } from '@/lib/identity'
import { connectWallet, shortAddr, watchAccount } from '@/lib/registry'

/**
 * Who you are on every page. In presentation mode: switch between the lawyer, the client and the developer
 * with one click (no MetaMask). Otherwise: the connected wallet.
 */
export default function WalletButton() {
  const [account, setAccount] = useState<Address | null>(null)
  const [available, setAvailable] = useState(false)
  const [persona, setActive] = useState<Persona | null>(null)

  useEffect(() => {
    personas().then((p) => setAvailable(!!p))
    setActive(activePersona())
    const sync = () => setActive(activePersona())
    window.addEventListener('lexdiff:identity', sync)
    const stop = watchAccount(setAccount)
    return () => {
      window.removeEventListener('lexdiff:identity', sync)
      stop()
    }
  }, [])

  const pick = (p: Persona | null) => {
    setPersona(p)
    setActive(p)
  }

  if (available) {
    return (
      <div className="row" style={{ gap: 6 }}>
        <span className="small muted">Presenting as</span>
        <div className="segmented">
          {(Object.keys(PERSONA_LABEL) as Persona[]).map((p) => (
            <button key={p} className={persona === p ? 'on' : ''} onClick={() => pick(p)} title={`Act as the ${PERSONA_LABEL[p].label.toLowerCase()}`}>
              {PERSONA_LABEL[p].icon} {PERSONA_LABEL[p].label}
            </button>
          ))}
          <button className={persona === null ? 'on' : ''} onClick={() => pick(null)} title="Use your own MetaMask wallet">
            🦊 {persona === null && account ? shortAddr(account) : 'My wallet'}
          </button>
        </div>
      </div>
    )
  }

  return account ? (
    <span className="wallet-pill" title={account}>{shortAddr(account)}</span>
  ) : (
    <button className="ghost" onClick={() => connectWallet().then((w) => setAccount(w.account)).catch(() => {})}>
      Connect wallet
    </button>
  )
}
