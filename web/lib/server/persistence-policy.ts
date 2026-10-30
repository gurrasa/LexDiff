export type PersistenceConfig={postgresUrl?:string; evidenceEncryptionKeyId?:string; auditRole?:string}
/** Fail closed: a local/ephemeral evidence store is not acceptable for production. */
export function productionPersistenceReady(c:PersistenceConfig):boolean{
 if(!c.postgresUrl||!c.evidenceEncryptionKeyId||!c.auditRole)return false
 try { const u=new URL(c.postgresUrl)
  return ['postgres:','postgresql:'].includes(u.protocol)&&u.hostname.length>0&&u.searchParams.get('sslmode')==='verify-full'&&c.evidenceEncryptionKeyId.length>=8&&c.auditRole.length>=3
 }catch{return false}
}
