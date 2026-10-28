import { Suspense } from 'react'
import AgreementView from './AgreementView'

export default function AgreementPage() {
  return (
    <Suspense fallback={<p className="muted">Loading agreement…</p>}>
      <AgreementView />
    </Suspense>
  )
}
