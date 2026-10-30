import { type Hex } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'

// Presentation mode: three built-in test identities whose keys live on the server, so one person can play
// every role with a click. Testnet only; enabled when all three keys are set.

export const PERSONAS = ['lawyer', 'client', 'developer'] as const
export type Persona = (typeof PERSONAS)[number]

const ENV: Record<Persona, string> = {
  lawyer: 'DEMO_LAWYER_KEY',
  client: 'DEMO_CLIENT_KEY',
  developer: 'DEMO_DEVELOPER_KEY',
}

export function personaAccount(persona: Persona) {
  const raw = process.env[ENV[persona]]?.trim()
  if (!raw) return null
  return privateKeyToAccount((raw.startsWith('0x') ? raw : `0x${raw}`) as Hex)
}

export const demoEnabled = () => PERSONAS.every((p) => personaAccount(p) !== null)
