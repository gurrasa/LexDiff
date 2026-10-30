import { type Address, type Hex, recoverTypedDataAddress } from 'viem'
import { loadPending } from '@/lib/pending'
import { ACCESS_HEADER, ACCESS_TTL, ACCESS_TYPES, DOMAIN, registry, same } from '@/lib/registry'

// Who may read which evidence. Terms and Chainlink reports are public: anyone must be able to re-check them
// against the on-chain hashes. The full agreement text and decision notes are confidential to the parties.

export const isPrivate = (value: unknown) => {
  const o = value as { schema?: unknown; note?: unknown } | null
  return o?.schema === 'lexdiff/agreement-document@1' || typeof o?.note === 'string'
}

type Parties = { client: string; reviewer: string; developer: string; freelancer: string }
const isParty = (p: Parties, reader: Address) => [p.client, p.reviewer, p.developer, p.freelancer].some((a) => same(a, reader))

/** The wallet that signed the request's read pass, if the pass is valid and unexpired. */
async function reader(request: Request): Promise<Address | null> {
  const [account, expires, signature] = request.headers.get(ACCESS_HEADER)?.split('.') ?? []
  if (!account || !/^\d{1,12}$/.test(expires ?? '') || !signature) return null
  const now = Date.now() / 1000
  if (Number(expires) < now || Number(expires) > now + ACCESS_TTL + 300) return null
  try {
    const signer = await recoverTypedDataAddress({
      domain: DOMAIN(),
      types: ACCESS_TYPES,
      primaryType: 'Access',
      message: { account: account as Address, expires: BigInt(expires) },
      signature: signature as Hex,
    })
    return same(signer, account) ? signer : null
  } catch {
    return null
  }
}

/**
 * A private document is released only when the reader is a party to the agreement (or signing request) named
 * in the query, and that agreement actually references the document: its signed text, or a note on one of
 * its recorded decisions.
 */
export async function mayRead(request: Request, hash: Hex): Promise<boolean> {
  const who = await reader(request)
  if (!who) return false
  const query = new URL(request.url).searchParams

  const agreementId = query.get('agreementId')
  if (agreementId && /^[1-9]\d{0,15}$/.test(agreementId)) {
    const id = BigInt(agreementId)
    const a = await registry.getAgreement(id).catch(() => null)
    if (a && isParty(a, who)) {
      if (same(a.agreementHash, hash)) return true
      const findings = await registry.getFindings(id)
      const decisions = await Promise.all(findings.map((f) => registry.getDecisions(id, f.key)))
      if (decisions.flat().some((d) => same(d.noteHash, hash))) return true
    }
  }

  const registrationId = query.get('registrationId')
  if (registrationId) {
    const p = await loadPending(registrationId)
    if (p && isParty(p.registration, who) && same(p.registration.agreementHash, hash)) return true
  }
  return false
}
