'use client'

import Link from 'next/link'
import { type ReactNode, useEffect, useState } from 'react'
import { activePersona, IDENTITY_EVENT, personas } from '@/lib/identity'

/**
 * Only the lawyer starts an agreement. In presentation mode the app knows who the lawyer is, so the client and the
 * developer do not get the button. With your own wallet anyone may start one, and becomes its lawyer. (Either way the
 * registry only accepts an agreement that both the lawyer and the client signed.)
 */
export function useCanCreate(): boolean {
  const [can, setCan] = useState(true)
  useEffect(() => {
    const sync = () =>
      personas().then((available) => {
        const p = activePersona()
        setCan(!available || p === null || p === 'lawyer')
      })
    sync()
    window.addEventListener(IDENTITY_EVENT, sync)
    return () => window.removeEventListener(IDENTITY_EVENT, sync)
  }, [])
  return can
}

export default function NewAgreementLink({ className, children }: { className?: string; children: ReactNode }) {
  return useCanCreate() ? (
    <Link href="/new" className={className}>
      {children}
    </Link>
  ) : null
}
