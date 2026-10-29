import { keccak256, toBytes } from 'viem'
import { type Coverage, coverage, type Finding, type OnchainValues } from './compare.ts'
import type { SourceAnalysis } from './source-analysis.ts'
import { canonicalize, type EscrowTerms } from './terms.ts'

// The full, human-readable report for one check. It is stored off-chain (it names vulnerabilities and
// parties); only its hash and the per-finding detail hashes are anchored on-chain.

export type ReportDocument = {
	schema: 'lexdiff/report@2'
	agreementId: string
	target: string
	codeHash: string
	termsHash: string
	contractName: string
	onchain: Record<string, string>
	privileged: SourceAnalysis['privileged']
	findings: Finding[]
	coverage: Coverage
}

export const buildReport = (
	agreementId: bigint,
	target: string,
	termsHash: string,
	terms: EscrowTerms,
	analysis: SourceAnalysis,
	onchain: OnchainValues,
	findings: Finding[],
): { canonical: string; hash: `0x${string}` } => {
	const doc: ReportDocument = {
		schema: 'lexdiff/report@2',
		agreementId: agreementId.toString(),
		target,
		codeHash: analysis.codeHash,
		termsHash,
		contractName: analysis.contractName,
		onchain: Object.fromEntries(Object.entries(onchain).map(([k, v]) => [k, String(v)])),
		privileged: analysis.privileged,
		findings,
		coverage: coverage(terms, findings),
	}
	const canonical = canonicalize(doc)
	return { canonical, hash: keccak256(toBytes(canonical)) }
}
