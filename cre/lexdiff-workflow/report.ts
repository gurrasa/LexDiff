import { keccak256, toBytes } from 'viem'
import type { Finding, OnchainValues } from './compare.ts'
import type { SourceAnalysis } from './source-analysis.ts'
import { canonicalize } from './terms.ts'

// The full, human-readable report for one check. It is stored off-chain (it names vulnerabilities and
// parties); only its hash and the per-finding detail hashes are anchored on-chain.

export type ReportDocument = {
	schema: 'lexdiff/report@1'
	agreementId: string
	target: string
	codeHash: string
	termsHash: string
	contractName: string
	onchain: Record<string, string>
	privileged: SourceAnalysis['privileged']
	findings: Finding[]
}

export const buildReport = (
	agreementId: bigint,
	target: string,
	termsHash: string,
	analysis: SourceAnalysis,
	onchain: OnchainValues,
	findings: Finding[],
): { canonical: string; hash: `0x${string}` } => {
	const doc: ReportDocument = {
		schema: 'lexdiff/report@1',
		agreementId: agreementId.toString(),
		target,
		codeHash: analysis.codeHash,
		termsHash,
		contractName: analysis.contractName,
		onchain: Object.fromEntries(Object.entries(onchain).map(([k, v]) => [k, String(v)])),
		privileged: analysis.privileged,
		findings,
	}
	const canonical = canonicalize(doc)
	return { canonical, hash: keccak256(toBytes(canonical)) }
}
