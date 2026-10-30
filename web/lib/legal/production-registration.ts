/** Existing registry ABI only requires client and reviewer; prevent claiming a legally complete production registration. */
export function productionRegistrationPermitted(env: Record<string,string|undefined> = process.env): boolean {
  // This version deliberately cannot enable production registration by an env flag.
  // A new on-chain signature-enforcing contract and audited migration are required.
  return env.NODE_ENV !== 'production'
}
