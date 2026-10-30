import type { Address } from 'viem'

// Which identity the browser acts as: a presentation-mode persona (keys on the server) or the user's own
// wallet (null). Kept in localStorage so it survives navigation; changes are broadcast as a window event.

export type Persona = 'lawyer' | 'client' | 'developer'
export const PERSONA_LABEL: Record<Persona, { icon: string; label: string }> = {
  lawyer: { icon: '⚖️', label: 'Lawyer' },
  client: { icon: '🏢', label: 'Client' },
  developer: { icon: '👩‍💻', label: 'Developer' },
}

const KEY = 'lexdiff:persona'
export const IDENTITY_EVENT = 'lexdiff:identity'

export function activePersona(): Persona | null {
  try {
    const p = localStorage.getItem(KEY)
    return p === 'lawyer' || p === 'client' || p === 'developer' ? p : null
  } catch {
    return null
  }
}

export function setPersona(p: Persona | null) {
  try {
    if (p) localStorage.setItem(KEY, p)
    else localStorage.removeItem(KEY)
  } catch {}
  window.dispatchEvent(new Event(IDENTITY_EVENT))
}

let cache: Promise<Record<Persona, Address> | null> | null = null
/** Persona addresses from the server, or null when presentation mode is off. */
export function personas(): Promise<Record<Persona, Address> | null> {
  cache ??= fetch('/api/personas')
    .then((r) => (r.ok ? r.json() : null))
    .catch(() => null)
  return cache
}

export async function personaAddress(): Promise<Address | null> {
  const p = activePersona()
  if (!p) return null
  return (await personas())?.[p] ?? null
}

const json = (v: unknown) => JSON.stringify(v, (_k, x) => (typeof x === 'bigint' ? x.toString() : x))

export async function personaAct<T>(body: Record<string, unknown>): Promise<T> {
  const res = await fetch('/api/demo/act', { method: 'POST', body: json({ persona: activePersona(), ...body }) })
  const out = await res.json()
  if (!res.ok) throw new Error(out.error)
  return out as T
}
