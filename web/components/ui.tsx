import Link from 'next/link'
import type { ReactNode } from 'react'
import type { Shown } from '@/lib/plain'

// Shared presentation pieces from design/components.html. Every status has an icon and a word;
// color is only a secondary cue.

export function Logo({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={Math.round(size * 1.1)} viewBox="0 0 80 88" aria-hidden="true">
      <path d="M10 4 H50 L70 24 V84 H10 Z" fill="var(--panel)" stroke="var(--ink)" strokeWidth="5" strokeLinejoin="round" />
      <path d="M50 4 V24 H70" fill="none" stroke="var(--ink)" strokeWidth="5" strokeLinejoin="round" />
      <rect x="20" y="36" width="36" height="7" rx="3.5" fill="var(--ink)" />
      <rect x="30" y="52" width="40" height="7" rx="3.5" fill="var(--brand)" />
      <rect x="20" y="68" width="26" height="7" rx="3.5" fill="var(--ink)" />
    </svg>
  )
}

const PATHS: Record<Shown, ReactNode> = {
  pass: <path d="m8 12 3 3 5-6" />,
  fail: <path d="m9 9 6 6M15 9l-6 6" />,
  inconclusive: <path d="M9.6 9.4a2.5 2.5 0 1 1 3.4 2.4c-.6.3-1 .8-1 1.5M12 17h.01" />,
  'not-checked': null,
}

export const RESULT_WORD: Record<Shown, string> = {
  pass: 'Pass',
  fail: 'Fail',
  inconclusive: 'Inconclusive',
  'not-checked': 'Not checked',
}

export function ResultIcon({ result, size = 16 }: { result: Shown; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeDasharray={result === 'not-checked' ? '3 3' : undefined}
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="9" />
      {PATHS[result]}
    </svg>
  )
}

/** Icon plus word, e.g. "✓ Pass". `children` replaces the word (e.g. "3 fail"). */
export function Result({ result, children, size }: { result: Shown; children?: ReactNode; size?: number }) {
  return (
    <span className={`result ${result}`}>
      <ResultIcon result={result} size={size} />
      {children ?? RESULT_WORD[result]}
    </span>
  )
}

export type Tone = 'ok' | 'warn' | 'bad' | 'power' | 'info' | 'muted'

export function Badge({ tone, children, title }: { tone: Tone; children: ReactNode; title?: string }) {
  return (
    <span className={`badge dot tone-${tone}`} title={title}>
      {children}
    </span>
  )
}

export function StatCard({ label, value, sub, icon, highlight, color }: {
  label: string
  value: ReactNode
  sub?: ReactNode
  icon?: Shown
  highlight?: boolean
  color?: string
}) {
  return (
    <div className={`stat-card${highlight ? ' highlight' : ''}`}>
      <span className="label" style={color ? { color, fontWeight: 500 } : undefined}>
        {icon && <ResultIcon result={icon} />}
        {label}
      </span>
      <span className="value">{value}</span>
      {sub && <span className="sub">{sub}</span>}
    </div>
  )
}

export function EmptyState({ title, children, action }: { title: string; children?: ReactNode; action?: { href: string; label: string } }) {
  return (
    <div className="empty">
      <strong>{title}</strong>
      {children && <p>{children}</p>}
      {action && <Link href={action.href} className="button small">{action.label}</Link>}
    </div>
  )
}

export function Loading({ label = 'Loading from Sepolia…' }: { label?: string }) {
  return (
    <div className="skeleton" role="status" aria-live="polite">
      <div className="bar title" />
      <div className="bar" style={{ width: '45%' }} />
      <div className="bar" style={{ width: '85%' }} />
      <span className="small muted">{label}</span>
    </div>
  )
}
