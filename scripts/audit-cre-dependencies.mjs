#!/usr/bin/env node
import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'

// Read-only advisory assessment.
// DO NOT run npm audit fix --force automatically.

const dir = resolve(process.cwd(), 'cre/lexdiff-workflow')

const isWindows = process.platform === 'win32'
const command = isWindows
  ? (process.env.ComSpec || 'cmd.exe')
  : 'npm'

const args = isWindows
  ? ['/d', '/s', '/c', 'npm audit --omit=dev --json']
  : ['audit', '--omit=dev', '--json']

const run = spawnSync(command, args, {
  cwd: dir,
  encoding: 'utf8',
  maxBuffer: 4 * 1024 * 1024,
  timeout: 120_000,
  windowsHide: true,
})

if (run.error) {
  console.error(run.error.message)
  process.exit(2)
}

let result

try {
  result = JSON.parse(run.stdout)
} catch {
  console.error('Unable to parse npm audit output; no release verdict')
  if (run.stderr) console.error(run.stderr)
  process.exit(2)
}

const list = result.vulnerabilities ?? {}

const unresolved = Object.entries(list)
  .filter(([, v]) =>
    v && ['high', 'critical'].includes(v.severity)
  )
  .map(([name, v]) => ({
    name,
    severity: v.severity,
    via: v.via,
    fixAvailable: v.fixAvailable,
  }))

console.log(JSON.stringify({
  highOrCritical: unresolved,
  metadata: result.metadata?.vulnerabilities ?? null,
}, null, 2))

if (run.status !== 0 && unresolved.length === 0) {
  console.error('Audit command failed without high/critical findings; no release verdict')
  process.exit(2)
}

process.exit(unresolved.length ? 1 : 0)
