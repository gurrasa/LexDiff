import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'

// Local demo helper: runs the real CRE workflow through the CRE CLI simulator and streams its log.
// Disabled unless ENABLE_LOCAL_CRE=true, and never meant for a hosted deployment.

/** The CRE installer puts the binary in ~/.cre/bin, which is often missing from the dev server's PATH. */
const creBinary = () => {
  if (process.env.CRE_BIN) return process.env.CRE_BIN
  const installed = path.join(homedir(), '.cre', 'bin', 'cre')
  return existsSync(installed) ? installed : 'cre'
}

export async function POST(request: Request) {
  if (process.env.ENABLE_LOCAL_CRE?.trim() !== 'true') {
    return Response.json(
      { error: 'Running the check from the browser is disabled. Set ENABLE_LOCAL_CRE=true in web/.env.local, or run the command in a terminal.' },
      { status: 403 },
    )
  }
  const { agreementId } = (await request.json()) as { agreementId?: string }
  if (!agreementId || !/^\d+$/.test(agreementId)) return Response.json({ error: 'bad agreementId' }, { status: 400 })

  const args = [
    'workflow', 'simulate', 'lexdiff-workflow',
    '--target', 'staging-settings', '--broadcast',
    '--non-interactive', '--trigger-index', '0',
    '--http-payload', JSON.stringify({ agreementId: Number(agreementId) }),
  ]
  // The CRE CLI shells out to bun to compile TypeScript workflows; include the default install dirs.
  const PATH = [path.join(homedir(), '.bun', 'bin'), path.join(homedir(), '.cre', 'bin'), process.env.PATH].join(path.delimiter)
  const child = spawn(creBinary(), args, {
    cwd: path.join(/* turbopackIgnore: true */ process.cwd(), '..', 'cre'),
    env: { ...process.env, PATH },
  })
  const encoder = new TextEncoder()

  const stream = new ReadableStream({
    start(controller) {
      // 'error' and 'close' can both fire (e.g. when the binary is missing); finish only once.
      let closed = false
      const send = (chunk: Buffer | string) => {
        if (!closed) controller.enqueue(encoder.encode(chunk.toString()))
      }
      const finish = (code: number | null) => {
        send(`\n__EXIT__${code}\n`)
        if (!closed) controller.close()
        closed = true
      }
      child.stdout.on('data', send)
      child.stderr.on('data', send)
      child.on('error', (err) => {
        send(`\nCould not start the CRE CLI: ${err.message}\nIs it installed in ~/.cre/bin or on your PATH? (or set CRE_BIN in web/.env.local)\n`)
        finish(1)
      })
      child.on('close', finish)
    },
    cancel() {
      child.kill()
    },
  })
  return new Response(stream, { headers: { 'content-type': 'text/plain; charset=utf-8' } })
}
