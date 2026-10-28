import type { Address } from 'viem'
import { type Agreement, type Check, type Finding, same } from './registry'

// Plain-language layer: what each on-chain state means for the people involved.

export type Role = 'client' | 'reviewer' | 'developer'

export const ROLES: Record<Role, { label: string; who: string; can: string }> = {
  client: {
    label: 'Client',
    who: 'Pays into the escrow.',
    can: 'Can knowingly accept a risk, and must approve any replacement contract.',
  },
  reviewer: {
    label: 'Reviewer',
    who: 'Legal counsel. Approved the terms.',
    can: 'Can require the developer to fix an issue.',
  },
  developer: {
    label: 'Developer',
    who: 'Wrote the smart contract.',
    can: 'Fixes issues and proposes the corrected contract.',
  },
}

export const rolesOf = (a: Agreement, account?: Address | null): Role[] =>
  account
    ? (['client', 'reviewer', 'developer'] as Role[]).filter((r) => same(account, a[r]))
    : []

export const roleNames = (a: Agreement, account: string) =>
  (['client', 'reviewer', 'developer'] as Role[])
    .filter((r) => same(account, a[r]))
    .map((r) => ROLES[r].label.toLowerCase())
    .join(' & ') || 'someone'

/** What the code does compared with the agreement. */
export const KIND_PLAIN = [
  'Matches the agreement',
  'The code does it differently',
  'The code is missing this',
  'The code gives someone a power the agreement does not',
] as const

/** Where the finding stands in the accountability process. */
export const STATUS_PLAIN = [
  'Matches',
  'Waiting for a decision',
  'Client accepted this risk',
  'Developer must fix this',
  'Fixed: confirmed by Chainlink',
] as const

export const STEPS = ['Agreement signed', 'Code checked', 'Decisions', 'Fix', 'Re-check', 'Ready'] as const

export type Stage = {
  step: number
  title: string
  detail: string
  waitingFor: Role | 'chainlink' | null
}

/** Derives where the agreement is in the journey, and who has to act next. */
export function stageOf(a: Agreement, findings: Finding[], checks: Check[]): Stage {
  const lastCheck = checks[checks.length - 1]
  const open = findings.filter((f) => f.status === 1).length
  const toFix = findings.filter((f) => f.status === 3).length
  const pending = a.pendingTarget !== '0x0000000000000000000000000000000000000000'

  if (!lastCheck) {
    return {
      step: 1,
      title: 'Chainlink needs to check the contract',
      detail: 'Chainlink reads the deployed code and compares it with the signed terms. Nobody involved in the deal controls this check.',
      waitingFor: 'chainlink',
    }
  }
  if (!same(lastCheck.target, a.target)) {
    return {
      step: 4,
      title: 'Chainlink needs to check the new contract',
      detail: 'The client approved a corrected contract. Only a new Chainlink check can confirm what was actually fixed.',
      waitingFor: 'chainlink',
    }
  }
  if (open > 0) {
    return {
      step: 2,
      title: `${open} issue${open > 1 ? 's' : ''} waiting for a decision`,
      detail: 'For each issue, the reviewer can require the developer to fix it, or the client can knowingly accept the risk. Every decision is signed.',
      waitingFor: 'reviewer',
    }
  }
  if (pending) {
    return {
      step: 3,
      title: 'The client needs to approve the corrected contract',
      detail: 'The developer proposed a new contract. The client holds the funds, so only the client can approve the switch.',
      waitingFor: 'client',
    }
  }
  if (toFix > 0) {
    return {
      step: 3,
      title: `The developer needs to fix ${toFix} issue${toFix > 1 ? 's' : ''}`,
      detail: 'Fix the code, deploy the corrected contract, and propose it here. Claiming it is fixed is not enough: Chainlink will check.',
      waitingFor: 'developer',
    }
  }
  return {
    step: 5,
    title: 'Every issue is fixed or knowingly accepted',
    detail: 'The client knows exactly what the contract does before funding it, and there is a signed record if anything is disputed later.',
    waitingFor: null,
  }
}
