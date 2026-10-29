import { isAddress } from 'viem'
import { publicClient } from '@/lib/registry'

/**
 * What the contract picker shows before anyone signs: is this a contract on Sepolia, and is its source
 * verified on Etherscan (the CRE workflow reads the verified source, so unverified code cannot be checked)?
 */
export async function GET(request: Request) {
  const address = new URL(request.url).searchParams.get('address') ?? ''
  if (!isAddress(address)) return Response.json({ error: 'not an address' }, { status: 400 })

  const code = await publicClient.getCode({ address }).catch(() => undefined)
  const isContract = !!code && code !== '0x'
  let verified: boolean | null = null
  let name: string | null = null

  const key = process.env.ETHERSCAN_API_KEY?.trim()
  if (isContract && key) {
    try {
      const url = `https://api.etherscan.io/v2/api?chainid=11155111&module=contract&action=getsourcecode&address=${address}&apikey=${key}`
      const body = await (await fetch(url)).json()
      const r = Array.isArray(body.result) ? body.result[0] : null
      verified = !!r?.SourceCode
      name = r?.ContractName || null
    } catch {}
  }
  return Response.json({ isContract, verified, name })
}
