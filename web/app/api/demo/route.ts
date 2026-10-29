import { readFile } from 'node:fs/promises'
import path from 'node:path'

/** Demo contract addresses written by contracts/script/Deploy.s.sol, so nobody has to copy them by hand. */
export async function GET() {
  try {
    const file = path.join(process.cwd(), '..', 'contracts', 'deployments', '11155111.json')
    const d = JSON.parse(await readFile(file, 'utf8'))
    return Response.json({ escrowV1: d.escrowV1 ?? null, escrowV2: d.escrowV2 ?? null, websiteEscrow: d.websiteEscrow ?? null })
  } catch {
    return Response.json({ escrowV1: null, escrowV2: null, websiteEscrow: null })
  }
}
