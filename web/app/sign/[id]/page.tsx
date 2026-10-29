import { Suspense } from 'react'
import SignView from './SignView'

export default function SignPage() {
  return (
    <Suspense fallback={<p className="muted">Loading…</p>}>
      <SignView />
    </Suspense>
  )
}
