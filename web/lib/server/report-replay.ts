import { createHash, timingSafeEqual } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

/** The identity supplied here MUST be authenticated by a production trust anchor.
 * Untrusted HTTP headers are not acceptable identities. This is an admission primitive,
 * not a complete CRE authentication mechanism.
 */
export type ReportAdmission = { agreementId:string; workflowId:string; signer:string; reportHash:string; sequence:number; expiresAt:number }
const hash=/^0x[0-9a-f]{64}$/i
export function validReportAdmission(a:ReportAdmission, now=Date.now()):boolean {
 return /^([1-9]\d{0,18})$/.test(a.agreementId) && hash.test(a.workflowId) && /^0x[0-9a-f]{40}$/i.test(a.signer) && hash.test(a.reportHash)
   && Number.isSafeInteger(a.sequence) && a.sequence>=0 && Number.isSafeInteger(a.expiresAt)
   && a.expiresAt>now && a.expiresAt<=now+5*60_000
}
/** Atomic O_EXCL admission across workers that use the SAME trustworthy shared filesystem.
 * Not suitable on serverless/ephemeral disks. Set report replay storage to a shared DB
 * with unique constraints before production or reject all production reports.
 */
export async function admitReportOnce(a:ReportAdmission, root:string, now=Date.now()):Promise<boolean> {
 if(!validReportAdmission(a,now) || !path.isAbsolute(root)) return false
 const key=createHash('sha256').update([a.agreementId,a.workflowId.toLowerCase(),a.signer.toLowerCase(),a.sequence].join(':')).digest('hex')
 await mkdir(root,{recursive:true,mode:0o700})
 try { await writeFile(path.join(root,`${key}.json`),JSON.stringify(a),{flag:'wx',mode:0o600}); return true }
 catch(e){if((e as NodeJS.ErrnoException).code==='EEXIST')return false;throw e}
}
export function equalsSha256Hex(a:string,b:string){
 if(!/^[0-9a-f]{64}$/i.test(a)||!/^[0-9a-f]{64}$/i.test(b))return false
 return timingSafeEqual(Buffer.from(a,'hex'),Buffer.from(b,'hex'))
}
