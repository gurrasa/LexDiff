import { keccak256, toBytes } from 'viem'
import { canonicalize } from '../terms'
import { redactFields, type ExportPermission, type Classification } from './export-policy'
export type SourceItem = {id:string; classification:Classification; content:string; evidenceHash:string}
export type FrozenManifest = {schema:'lexdiff/export-manifest@1'; cutoff:string; recipient:string; sourceHash:string; includedEvidenceIds:string[]; excludedEvidenceIds:string[]; exclusionReasons:Record<string,string>; verificationWarnings:string[]; outputHash:string}
const HEX=/^0x[0-9a-f]{64}$/i
/** A derivative manifest only; does not grant permissions or authorize disclosure. */
export function buildExportManifest(items:readonly SourceItem[], policy:ExportPermission, cutoff:string, sourceHash:string) {
 if(!HEX.test(sourceHash)) throw new Error('Source snapshot hash must be verified')
 if(!Number.isFinite(Date.parse(cutoff))) throw new Error('Invalid cutoff')
 const {included,exclusions}=redactFields(items,policy)
 const warnings:string[]=[]
 for(const x of included){if(!HEX.test(x.evidenceHash)) warnings.push(`Unverified evidence digest: ${x.id}`)}
 const safe=included.map(x=>({id:x.id,classification:x.classification,content:x.content,evidenceHash:x.evidenceHash}))
 const outputHash=keccak256(toBytes(canonicalize(safe)))
 const manifest:FrozenManifest={schema:'lexdiff/export-manifest@1',cutoff,recipient:policy.audience,sourceHash,includedEvidenceIds:safe.map(x=>x.id),excludedEvidenceIds:exclusions.map(x=>x.id),exclusionReasons:Object.fromEntries(exclusions.map(x=>[x.id,x.reason])),verificationWarnings:warnings,outputHash}
 return {items:safe,manifest}
}
