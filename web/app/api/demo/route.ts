import { readFile } from 'node:fs/promises'
import path from 'node:path'

/** Demo contract addresses written by contracts/script/Deploy.s.sol, so nobody has to copy them by hand. */
export async function GET() {
  try {
    // contracts/deployments when running from the repo; web/deployments.json (a copy the deploy script writes)
    // when only web/ is deployed, e.g. on Railway.
    const files = [
      path.join(/* turbopackIgnore: true */ process.cwd(), '..', 'contracts', 'deployments', '11155111.json'),
      path.join(/* turbopackIgnore: true */ process.cwd(), 'deployments.json'),
    ]
    let d: Record<string, string> | null = null
    for (const file of files) {
      d = await readFile(file, 'utf8').then(JSON.parse).catch(() => null)
      if (d) break
    }
    if (!d) throw new Error('no deployment file')
    return Response.json({
      escrowV1: d.escrowV1 ?? null,
      escrowV2: d.escrowV2 ?? null,
      websiteEscrow: d.websiteEscrow ?? null,
      // The parties the demo escrows were deployed with; the deployer owns them, i.e. is the developer.
      client: d.client ?? null,
      freelancer: d.freelancer ?? null,
      developer: d.developer ?? null,
    })
  } catch {
    return Response.json({ escrowV1: null, escrowV2: null, websiteEscrow: null, client: null, freelancer: null, developer: null })
  }
}
