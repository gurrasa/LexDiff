import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { hashTypedData, type Hex } from 'viem'
import { DOMAIN, type PendingRegistration, type Registration, REGISTRATION_TYPES, registrationToJson } from './registry'

// Server-side store for registrations waiting for signatures (one JSON file per registration).
// The id is the EIP-712 digest both parties sign, i.e. exactly what the registry checks on-chain.

const DIR = process.env.REGISTRATIONS_DIR || path.join(process.cwd(), 'data', 'registrations')

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
