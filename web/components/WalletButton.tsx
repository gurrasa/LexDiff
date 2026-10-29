'use client'

import { useEffect, useState } from 'react'
import type { Address } from 'viem'
import { connectWallet, shortAddr, watchAccount } from '@/lib/registry'

/** Shows which wallet you are using on every page; switching account in MetaMask updates it. */
export default function WalletButton() {
  const [account, setAccount] = useState<Address | null>(null)
  useEffect(() => watchAccount(setAccount), [])
  return account ? (
    <span className="badge tone-info mono" title={account}>● {shortAddr(account)}</span>
  ) : (
    <button className="small ghost" onClick={() => connectWallet().then((w) => setAccount(w.account)).catch(() => {})}>
      Connect wallet
    </button>
  )
}
