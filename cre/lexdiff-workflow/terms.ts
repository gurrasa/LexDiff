import { keccak256, toBytes } from 'viem'
import { z } from 'zod'

// Structured terms of an escrow agreement, as extracted by Claude and reviewed by counsel.
// Keep in sync with web/lib/terms.ts.

export const POWER_CATEGORIES = [
	'withdraw-funds',
	'pause',
	'upgrade',
	'modify-terms',
	'destroy',
	'other',
] as const

export const escrowTermsSchema = z.object({
	schema: z.literal('lexdiff/escrow-terms@1'),
	title: z.string(),
	parties: z.object({
		client: z.object({ name: z.string(), wallet: z.string() }),
		freelancer: z.object({ name: z.string(), wallet: z.string() }),
	}),
	payment: z.object({
		tokenSymbol: z.string(),
		tokenAddress: z.string(),
		amount: z.string(),
		decimals: z.number().int(),
	}),
	deadlines: z.object({
		deliveryPeriodDays: z.number(),
		reviewPeriodDays: z.number(),
	}),
	payoutConditions: z.array(z.string()),
	refund: z.object({
		onMissedDeadline: z.boolean(),
		description: z.string(),
	}),
	adminPowers: z.array(
		z.object({
			category: z.enum(POWER_CATEGORIES),
			description: z.string(),
		}),
	),
	sourceClauses: z.array(
		z.object({
			term: z.string(),
			quote: z.string(),
		}),
	),
})

export type EscrowTerms = z.infer<typeof escrowTermsSchema>
export type PowerCategory = (typeof POWER_CATEGORIES)[number]

/** Deterministic JSON: object keys sorted, no whitespace. */
export const canonicalize = (value: unknown): string => {
	if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`
	if (value !== null && typeof value === 'object') {
		const entries = Object.entries(value as Record<string, unknown>)
			.filter(([, v]) => v !== undefined)
			.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
		return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalize(v)}`).join(',')}}`
	}
	return JSON.stringify(value)
}

export const termsHash = (terms: EscrowTerms): `0x${string}` => keccak256(toBytes(canonicalize(terms)))
