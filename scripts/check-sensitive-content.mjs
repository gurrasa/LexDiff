/** Scan staged tracked content for common credential patterns without printing secrets. */
import { execFileSync } from 'node:child_process'
const names=execFileSync('git',['diff','--cached','--name-only','-z'],{encoding:'utf8'}).split('\0').filter(Boolean)
const patterns=[/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/, /(?:^|\W)(?:PRIVATE_KEY|API_SECRET|SECRET_ACCESS_KEY)\s*[:=]\s*["']?0x[0-9a-f]{64}/im,/\b(?:ghp_|github_pat_|sk_live_)[a-zA-Z0-9_-]{16,}\b/]
let errors=0
for(const file of names){
 if (/\.(?:png|jpe?g|zip|pdf|ico|lock)$/.test(file)) continue
 let body; try{body=execFileSync('git',['show',`:${file}`],{encoding:'utf8',maxBuffer:4*1024*1024})}catch{continue}
 if(patterns.some(p=>p.test(body))){console.error(`Potential credential detected in staged file: ${file}`);errors++}
}
if(errors)process.exitCode=1
else console.log(`OK: no matching credentials in ${names.length} staged files (heuristic scan; not a history scan)`)
