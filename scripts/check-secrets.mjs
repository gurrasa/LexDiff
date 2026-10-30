import { execFileSync } from 'node:child_process'

const tracked = execFileSync('git', ['ls-files'], { encoding: 'utf8' }).trim().split(/\r?\n/)
const forbidden = tracked.filter(file => /(^|\/)(?:\.env(?:\..+)?|secrets\.yaml|[^/]+\.pem|id_rsa)$/.test(file) && !file.endsWith('.env.example'))
if (forbidden.length) {
  console.error('Tracked secret-sensitive filenames:', forbidden.join(', '))
  process.exitCode = 1
} else console.log('OK: no tracked environment or CRE secrets files')
