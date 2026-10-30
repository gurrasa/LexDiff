/** Never derive operational activation from registry target changes or code-level checks. */
export type OperationalState = 'NotActive'|'MigrationPending'|'ReadyForManualActivation'
export function operationalState(e: {replacementRegistered:boolean; migrationVerified:boolean; affectedConsentVerified:boolean; technicalChecksPassed:boolean}):OperationalState {
 if (!e.replacementRegistered) return 'NotActive'
 if (!e.migrationVerified || !e.affectedConsentVerified || !e.technicalChecksPassed) return 'MigrationPending'
 return 'ReadyForManualActivation' // never infer 'Active'
}
