import { formatUnits, isAddress, keccak256, parseUnits, toBytes } from 'viem'
import type { AbiFunction, SourceAnalysis } from './source-analysis.ts'
import { canonicalize, type EscrowTerms } from './terms.ts'

// Deterministic agreement-vs-code comparison. Pure functions only: same inputs, same findings, on every node.

// Mirrors LexDiffRegistry.Kind
export const Kind = { Match: 0, Mismatch: 1, Missing: 2, HiddenPower: 3 } as const
export type Kind = (typeof Kind)[keyof typeof Kind]

export type Finding = {
	key: `0x${string}`
	kind: Kind
	clause: string
	expected: string
	actual: string
	/** keccak256 of canonical {clause, expected, actual}: the only part of the details that goes on-chain */
	detailsHash: `0x${string}`
}

/** Terms that are checked against a getter on the deployed contract. */
export const GETTER_CANDIDATES = {
	client: { type: 'address', names: ['client', 'buyer', 'payer', 'depositor'] },
	freelancer: { type: 'address', names: ['freelancer', 'seller', 'payee', 'contractor', 'beneficiary'] },
	token: { type: 'address', names: ['token', 'paymentToken', 'asset', 'usdc'] },
	amount: { type: 'uint256', names: ['amount', 'escrowAmount', 'depositAmount', 'price', 'totalAmount'] },
	deliveryPeriod: {
		type: 'uint256',
		names: ['deliveryPeriod', 'deliveryWindow', 'deliveryDeadline', 'deadlineDuration', 'deliveryDuration'],
	},
	reviewPeriod: { type: 'uint256', names: ['reviewPeriod', 'reviewWindow', 'reviewDuration', 'disputePeriod'] },
} as const

export type GetterTerm = keyof typeof GETTER_CANDIDATES

const normalize = (name: string) => name.replace(/_/g, '').toLowerCase()

/** Maps each term to the zero-argument view function that exposes it, if any. */
export const resolveGetters = (abi: AbiFunction[]): Partial<Record<GetterTerm, string>> => {
	const out: Partial<Record<GetterTerm, string>> = {}
	for (const term of Object.keys(GETTER_CANDIDATES) as GetterTerm[]) {
		const { type, names } = GETTER_CANDIDATES[term]
		for (const candidate of names) {
			const fn = abi.find(
				(f) =>
					normalize(f.name) === normalize(candidate) &&
					f.inputs === 0 &&
					(f.stateMutability === 'view' || f.stateMutability === 'pure') &&
					f.outputs.length === 1 &&
					f.outputs[0] === type,
			)
			if (fn) {
				out[term] = fn.name
				break
			}
		}
	}
	return out
}

export type OnchainValues = {
	client?: string
	freelancer?: string
	token?: string
	amount?: bigint
	deliveryPeriod?: bigint
	reviewPeriod?: bigint
	tokenSymbol?: string
}

export const findingKey = (id: string): `0x${string}` => keccak256(toBytes(id))

export const detailsHash = (clause: string, expected: string, actual: string): `0x${string}` =>
	keccak256(toBytes(canonicalize({ clause, expected, actual })))

export const formatDuration = (seconds: bigint): string => {
	if (seconds % 86400n === 0n) return `${seconds / 86400n} days`
	if (seconds % 3600n === 0n) return `${seconds / 3600n} hours`
	return `${seconds} seconds`
}

const REFUND_NAMES = /refund|reclaim|cancel|withdrawdeposit|clawback/i

export const compare = (terms: EscrowTerms, analysis: SourceAnalysis, onchain: OnchainValues): Finding[] => {
	const findings: Finding[] = []
	const push = (id: string, kind: Kind, clause: string, expected: string, actual: string) =>
		findings.push({ key: findingKey(id), kind, clause, expected, actual, detailsHash: detailsHash(clause, expected, actual) })

	const addressTerm = (id: GetterTerm, clause: string, expected: string, actual: string | undefined) => {
		if (actual === undefined) return push(`term:${id}`, Kind.Missing, clause, expected, 'no getter in contract')
		if (!isAddress(expected)) return push(`term:${id}`, Kind.Mismatch, clause, `${expected} (no wallet in terms)`, actual)
		const same = expected.toLowerCase() === actual.toLowerCase()
		push(`term:${id}`, same ? Kind.Match : Kind.Mismatch, clause, expected, actual)
	}

	addressTerm('client', 'Client (depositor)', terms.parties.client.wallet, onchain.client)
	addressTerm('freelancer', 'Freelancer (payee)', terms.parties.freelancer.wallet, onchain.freelancer)

	// Token: compare address when the agreement names one, otherwise the symbol.
	const tokenClause = 'Payment token'
	if (onchain.token === undefined) {
		push('term:token', Kind.Missing, tokenClause, terms.payment.tokenSymbol, 'no token getter in contract')
	} else if (isAddress(terms.payment.tokenAddress)) {
		const same = terms.payment.tokenAddress.toLowerCase() === onchain.token.toLowerCase()
		push('term:token', same ? Kind.Match : Kind.Mismatch, tokenClause, terms.payment.tokenAddress, onchain.token)
	} else {
		const symbol = onchain.tokenSymbol ?? ''
		const same = symbol.toUpperCase().includes(terms.payment.tokenSymbol.toUpperCase())
		push('term:token', same ? Kind.Match : Kind.Mismatch, tokenClause, terms.payment.tokenSymbol, `${symbol} (${onchain.token})`)
	}

	const expectedAmount = parseUnits(terms.payment.amount, terms.payment.decimals)
	const amountText = (v: bigint) => `${formatUnits(v, terms.payment.decimals)} ${terms.payment.tokenSymbol}`
	if (onchain.amount === undefined) {
		push('term:amount', Kind.Missing, 'Escrow amount', amountText(expectedAmount), 'no amount getter in contract')
	} else {
		push(
			'term:amount',
			onchain.amount === expectedAmount ? Kind.Match : Kind.Mismatch,
			'Escrow amount',
			amountText(expectedAmount),
			amountText(onchain.amount),
		)
	}

	const durationTerm = (id: GetterTerm, clause: string, days: number, actual: bigint | undefined) => {
		const expected = BigInt(Math.round(days * 86400))
		if (actual === undefined) return push(`term:${id}`, Kind.Missing, clause, formatDuration(expected), 'not defined in contract')
		push(`term:${id}`, actual === expected ? Kind.Match : Kind.Mismatch, clause, formatDuration(expected), formatDuration(actual))
	}
	durationTerm('deliveryPeriod', 'Delivery deadline', terms.deadlines.deliveryPeriodDays, onchain.deliveryPeriod)
	durationTerm('reviewPeriod', 'Client review period', terms.deadlines.reviewPeriodDays, onchain.reviewPeriod)

	if (terms.refund.onMissedDeadline) {
		const refundFn = analysis.abi.find(
			(f) => REFUND_NAMES.test(f.name) && f.stateMutability !== 'view' && f.stateMutability !== 'pure',
		)
		push(
			'term:refundOnMissedDeadline',
			refundFn ? Kind.Match : Kind.Missing,
			'Refund if deadline is missed',
			terms.refund.description || 'client refunded when delivery deadline is missed',
			refundFn ? `${refundFn.name}()` : 'no refund function',
		)
	}

	// Privileged functions the agreement does not grant are hidden powers.
	const granted = new Set(terms.adminPowers.map((p) => p.category))
	for (const fn of analysis.privileged) {
		const declared = granted.has(fn.category)
		push(
			`power:${fn.name}`,
			declared ? Kind.Match : Kind.HiddenPower,
			`Admin power: ${fn.category}`,
			declared ? `granted by agreement (${fn.category})` : 'not granted by agreement',
			`${fn.name}() guarded by ${fn.guard}`,
		)
	}

	return findings
}
