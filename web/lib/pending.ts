import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { hashTypedData, type Hex } from 'viem'
import { DOMAIN, type PendingRegistration, type Registration, REGISTRATION_TYPES, registrationToJson } from './registry'

// Server-side store for registrations waiting for signatures (one JSON file per registration).
// The id is the EIP-712 digest both parties sign, i.e. exactly what the registry checks on-chain.

const DIR = process.env.REGISTRATIONS_DIR?.trim() || path.join(process.cwd(), 'data', 'registrations')

export const registrationId = (r: Registration): Hex =>
  hashTypedData({ domain: DOMAIN(), types: REGISTRATION_TYPES, primaryType: 'Registration', message: r })

type Stored = Omit<PendingRegistration, 'registration'> & { registration: ReturnType<typeof registrationToJson> }

export async function loadPending(id: string): Promise<Stored | null> {
  if (!/^0x[0-9a-f]{64}$/.test(id)) return null
  try {
    return JSON.parse(await readFile(path.join(DIR, `${id}.json`), 'utf8'))
  } catch {
    return null
  }
}

export async function savePending(p: Stored) {
  await mkdir(DIR, { recursive: true })
  await writeFile(path.join(DIR, `${p.id}.json`), JSON.stringify(p, null, 2))
}

/** Pending registrations in which `address` is the client or the reviewer and has not signed yet. */
export async function pendingFor(address: string): Promise<Stored[]> {
  const files = await readdir(/* turbopackIgnore: true */ DIR).catch(() => [] as string[])
  const all = await Promise.all(files.filter((f) => f.endsWith('.json')).map((f) => loadPending(f.slice(0, -5))))
  const me = address.toLowerCase()
  return all.filter((p): p is Stored => {
    if (!p || p.agreementId) return false
    const r = p.registration
    if (Number(r.deadline) < Date.now() / 1000) return false
    return (r.client.toLowerCase() === me && !p.signatures.client) || (r.reviewer.toLowerCase() === me && !p.signatures.reviewer)
  })
}
