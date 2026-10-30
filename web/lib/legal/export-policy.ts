/** Conservative recipient classification for exports; default to no external disclosure. */
export type ExportAudience = 'internal-legal'|'parties'|'external-counsel'|'resolver'
export type Classification = 'public-technical'|'shared-contract'|'confidential'|'privileged'
export type ExportPermission = { authenticated: boolean; agreementScoped: boolean; authorizedRole: boolean; approvedDisclosure: boolean; audience: ExportAudience }
export function exportAllowed(p:ExportPermission):boolean {
 return p.authenticated && p.agreementScoped && p.authorizedRole && p.approvedDisclosure
}
export function redactFields<T extends { classification: Classification; content: string; id: string }>(items: readonly T[], p: ExportPermission): { included: T[]; exclusions: { id:string; reason:string }[] } {
 // No unreviewed privilege inference: public-technical only for authenticated, explicitly approved recipient.
 if (!exportAllowed(p)) return {included:[],exclusions:items.map(x=>({id:x.id,reason:'Recipient not authorized for export'}))}
 const permitted = p.audience==='internal-legal' ? new Set<Classification>(['public-technical','shared-contract','confidential','privileged']) : p.audience==='parties' ? new Set<Classification>(['public-technical','shared-contract']) : new Set<Classification>(['public-technical'])
 return {included:items.filter(x=>permitted.has(x.classification)),exclusions:items.filter(x=>!permitted.has(x.classification)).map(x=>({id:x.id,reason:`Classification ${x.classification} not authorized for audience ${p.audience}`}))}
}
