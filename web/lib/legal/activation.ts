/** A registry target update is not an operational migration. Never infer Active from an address change. */
export type ActivationEvidence = {
  oldTarget: string; newTarget: string; approvedByClient: boolean; approvedByCounterparty: boolean;
  specifiedChecksPassed: boolean; oldFundsMinor: bigint | null; escrowMigrationTx?: string;
  newFundsMinor: bigint | null; allowanceReviewed: boolean; rolesReviewed: boolean; incidentReviewComplete: boolean;
}
export function evaluateActivation(e: ActivationEvidence): { state: 'MigrationPending' | 'ReadyForManualActivation'; blockers: string[] } {
  const b: string[] = []
  if (!e.approvedByClient) b.push('Client approval missing')
  if (!e.approvedByCounterparty) b.push('Affected counterparty approval missing')
  if (!e.specifiedChecksPassed) b.push('Specified verification not passed')
  if (!/^0x[0-9a-f]{40}$/i.test(e.newTarget) || e.newTarget.toLowerCase() === e.oldTarget.toLowerCase()) b.push('Distinct valid new target required')
  if (e.oldFundsMinor === null) b.push('Old escrow balance unknown')
  else if (e.oldFundsMinor !== BigInt(0)) b.push('Old escrow still holds funds')
  if (e.newFundsMinor === null) b.push('New escrow funding unknown')
  if (!e.escrowMigrationTx || !/^0x[0-9a-f]{64}$/i.test(e.escrowMigrationTx)) b.push('Migration transaction proof missing')
  if (!e.allowanceReviewed) b.push('Allowance implications not reviewed')
  if (!e.rolesReviewed) b.push('Admin and recipient roles not reviewed')
  if (!e.incidentReviewComplete) b.push('Historical incident/remedy review outstanding')
  return { state: b.length ? 'MigrationPending' : 'ReadyForManualActivation', blockers: b }
}
