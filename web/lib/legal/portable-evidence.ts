import {keccak256,toBytes} from 'viem'
import {canonicalize} from '../terms'
export type PortableEntry={id:string;content:string;classification:'public-technical'|'shared-contract'|'confidential'|'privileged';hash:string}
const H=/^0x[0-9a-f]{64}$/i
/** Byte-clean portable JSON derivative; NOT an archive and NOT an authorization check. */
export function buildPortableEvidence(entries:readonly PortableEntry[],allowedIds:readonly string[],cutoff:string){
 if(!Number.isFinite(Date.parse(cutoff)))throw new Error('Invalid snapshot cutoff')
 const allow=new Set(allowedIds),seen=new Set<string>();const excluded:string[]=[];const included:PortableEntry[]=[];const warnings:string[]=[]
 for(const e of entries){if(seen.has(e.id))throw new Error(`Duplicate evidence ID ${e.id}`);seen.add(e.id);if(!allow.has(e.id)){excluded.push(e.id);continue}if(!H.test(e.hash)||keccak256(toBytes(e.content)).toLowerCase()!==e.hash.toLowerCase())warnings.push(`Evidence hash mismatch: ${e.id}`);included.push({...e})}
 const sorted=included.sort((a,b)=>a.id.localeCompare(b.id));const body={schema:'lexdiff/portable-evidence@1',cutoff,included:sorted,excluded:excluded.sort(),warnings}
 return {...body,manifestHash:keccak256(toBytes(canonicalize(body)))}
}
