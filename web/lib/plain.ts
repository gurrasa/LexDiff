import type { Address } from 'viem'
import { type Agreement, type Check, Disposition, type Finding, Remediation, same, Verification } from './registry'

// Plain-language layer: what each on-chain state means for the people involved.

export type Role = 'client' | 'reviewer' | 'developer' | 'freelancer'

export const ROLES: Record<Role, { label: string; who: string; can: string }> = {
  client: {
    label: 'Client',
    who: 'Will fund the escrow.',
    can: 'Can knowingly accept a failing property as a risk, and approves which contract to fund.',
  },
  reviewer: {
    label: 'Lawyer',
    who: 'Legal counsel. Approved the terms.',
    can: 'Can require the developer to fix a failing property.',
  },
  developer: {
    label: 'Developer',
    who: 'Wrote the smart contract.',
    can: 'Fixes properties and proposes the corrected contract.',
  },
  freelancer: {
    label: 'Payee',
    who: 'Gets paid from the escrow (usually the developer).',
    can: 'Can confirm having seen a finding, or dispute it.',
  },
}

const ALL: Role[] = ['client', 'reviewer', 'developer', 'freelancer']

/** The roles this wallet holds. A developer who is also the payee is shown simply as the developer. */
export const rolesOf = (a: Agreement, account?: Address | null): Role[] => {
  const roles = account ? ALL.filter((r) => same(account, a[r])) : []
  return roles.includes('developer') ? roles.filter((r) => r !== 'freelancer') : roles
}

export const roleNames = (a: Agreement, account: string) =>
  rolesOf(a, account as Address)
    .map((r) => (r === 'reviewer' ? 'lawyer' : ROLES[r].label.toLowerCase()))
    .join(' & ') || 'someone'

/** What the comparison observed. */
export const KIND_PLAIN = [
  'Matches the agreement',
  'The code does it differently',
  'The code is missing this',
  'The code gives someone a power the agreement does not',
] as const

export const isFailing = (f: Finding) => f.verification === Verification.Fail || f.verification === Verification.Inconclusive

/**
 * A failing property that still needs a decision: nobody decided yet, or someone disputed it and no fix is
 * underway. A dispute blocks the process until the lawyer requires a fix or the client accepts the risk.
 */
const undecided = (f: Finding) =>
  isFailing(f) &&
  f.remediation === Remediation.None &&
  (f.disposition === Disposition.Undecided || f.disposition === Disposition.Disputed)

export const STEPS = ['Agreement signed', 'Code checked', 'Decisions', 'Fix', 'Re-check', 'Decided'] as const

export type Stage = {
  step: number
  title: string
  detail: string
  waitingFor: Role | 'chainlink' | null
}

export type Summary = { fixed: number; accepted: number; disputed: number; failing: number; notChecked: number }

export const summarize = (findings: Finding[]): Summary => ({
  fixed: findings.filter((f) => f.remediation === Remediation.FixVerified).length,
  accepted: findings.filter((f) => isFailing(f) && f.disposition === Disposition.Accepted).length,
  disputed: findings.filter((f) => f.disposition === Disposition.Disputed).length,
  failing: findings.filter(isFailing).length,
  notChecked: findings.filter((f) => f.verification === Verification.NotChecked).length,
})

/** Derives where the agreement is in the journey, and who has to act next. */
export function stageOf(a: Agreement, findings: Finding[], checks: Check[]): Stage {
  const lastCheck = checks[checks.length - 1]
  const toDecide = findings.filter(undecided).length
  const toFix = findings.filter(
    (f) => f.remediation === Remediation.Required || f.remediation === Remediation.Reopened,
  ).length
  const pending = a.pendingTarget !== '0x0000000000000000000000000000000000000000'
  const s = summarize(findings)

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
      title: 'Chainlink needs to check the approved contract',
      detail: 'Only a new check can show which properties now pass. A fix counts only when the same property explicitly passes.',
      waitingFor: 'chainlink',
    }
  }
  if (toDecide > 0) {
    return {
      step: 2,
      title: `${toDecide} failing propert${toDecide > 1 ? 'ies need' : 'y needs'} a decision`,
      detail: 'For each one, the lawyer can require a fix, or the client can knowingly accept the risk. A disputed property needs one of those decisions too. Accepting does not make it pass. Every decision is signed.',
      waitingFor: 'reviewer',
    }
  }
  if (pending) {
    return {
      step: 3,
      title: 'The client needs to approve the corrected contract',
      detail: 'Approving chooses which contract the client will fund. It does not move any money; the next check reports where the funds actually are.',
      waitingFor: 'client',
    }
  }
  if (toFix > 0) {
    return {
      step: 3,
      title: `The developer needs to fix ${toFix} propert${toFix > 1 ? 'ies' : 'y'}`,
      detail: 'Fix the code, deploy the corrected contract, and propose it here. Saying it is fixed is not enough: Chainlink checks the same properties again.',
      waitingFor: 'developer',
    }
  }
  const remaining = [
    s.accepted && `${s.accepted} still failing with the risk accepted by the client`,
    s.disputed && `${s.disputed} disputed`,
    s.notChecked && `${s.notChecked} not checked in the latest run`,
  ].filter(Boolean)
  return {
    step: 5,
    title: s.failing === 0 ? 'Every checked property passes' : 'Every failing property has a decision',
    detail:
      `${s.fixed} fix${s.fixed === 1 ? '' : 'es'} verified by Chainlink.` +
      (remaining.length ? ` Remaining: ${remaining.join('; ')}.` : '') +
      ' This is a record of what was checked and decided, not a guarantee that the contract is secure.',
    waitingFor: null,
  }
}
