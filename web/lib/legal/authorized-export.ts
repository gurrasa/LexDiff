import {createHash} from 'node:crypto'
export type ExportAudience='client'|'freelancer'|'reviewer'|'developer'|'resolver'
export type ExportEvidence={hash:string;agreementId:string;audiences:ExportAudience[];content:string;privileged?:boolean}
export type ExportRequest={agreementId:string;requester:string;recipient:string;role:ExportAudience;grants:Record<string,readonly string[]>}
const HASH=/^0x[0-9a-f]{64}$/i
const wallet=(v:string)=>/^0x[0-9a-f]{40}$/i.test(v)
/** Authorization must use server-fetched, cryptographically/contract-verified role grants,
 * NEVER client-supplied `grants`. Resolver grants require separate documented approval.
 */
export function authorizedExport(request:ExportRequest,records:readonly ExportEvidence[]){
 if(!wallet(request.requester)||!wallet(request.recipient)||!request.agreementId||!request.grants[request.role]?.some(a=>a.toLowerCase()===request.requester.toLowerCase())) return {ok:false as const,reason:'Unauthorized'}
 // No implicit transfer to an arbitrary email/wallet/third party.
 if(request.recipient.toLowerCase()!==request.requester.toLowerCase())return {ok:false as const,reason:'Recipient authorization required'}
 const disclosure: {hash:string;sha256:string;content:string}[]=[]
 const exclusions:{hash:string;reason:string}[]=[]
 for(const r of records){
  if(!HASH.test(r.hash)||r.agreementId!==request.agreementId)return {ok:false as const,reason:'Incomplete or invalid evidence scope'}
  if(r.privileged||!r.audiences.includes(request.role)){exclusions.push({hash:r.hash,reason:'Withheld for this recipient'});continue}
  disclosure.push({hash:r.hash,content:r.content,sha256:createHash('sha256').update(r.content).digest('hex')})
 }
 return {ok:true as const,manifest:{agreementId:request.agreementId,role:request.role,recipient:request.recipient,entries:disclosure.map(({hash,sha256})=>({hash,sha256})),exclusions},records:disclosure}
}
