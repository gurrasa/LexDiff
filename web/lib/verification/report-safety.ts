/** Minimum logical guard against overstated verified findings. Does not prove CRE authenticity. */
type Obj=Record<string,unknown>
export function reportSafetyIssues(report:unknown):string[] {
 if (!report || typeof report!=='object' || Array.isArray(report)) return ['Report is not an object']
 const r=report as Obj;const findings=Array.isArray(r.findings)?r.findings:[]
 const errors:string[]=[]
 for(const [i,v] of findings.entries()){
  if(!v || typeof v!=='object' || Array.isArray(v)){errors.push(`Invalid finding ${i}`);continue}
  const f=v as Obj
  const method=String(f.method ?? f.verificationMethod ?? '')
  // Only prohibit explicit structural-only positive assertions. Missing method is
  // separately warned, not rejected, for compatibility with existing reports.
  if(Number(f.result)===1 && /^(source-structure|structural|text-pattern)$/i.test(method)) errors.push(`Structural observation cannot Pass: ${i}`)
 }
 return errors
}
