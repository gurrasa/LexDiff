import { keccak256, toBytes } from 'viem'
import type { PowerCategory } from './terms.ts'

// Deterministic static analysis of Etherscan-verified Solidity source.
// No heuristics that depend on time, randomness or network — every DON node must reach the same output.

export type AbiFunction = {
	name: string
	stateMutability: string
	inputs: number
	outputs: string[]
}

export type PrivilegedFunction = {
	name: string
	category: PowerCategory
	guard: string
}

export type SourceAnalysis = {
	contractName: string
	codeHash: `0x${string}`
	abi: AbiFunction[]
	privileged: PrivilegedFunction[]
}

export type EtherscanSourceResult = {
	SourceCode: string
	ABI: string
	ContractName: string
}

/** Removes comments while leaving string literals intact. */
export const stripComments = (src: string): string => {
	let out = ''
	let i = 0
	while (i < src.length) {
		const c = src[i]
		const next = src[i + 1]
		if (c === '"' || c === "'") {
			let j = i + 1
			while (j < src.length && src[j] !== c) j += src[j] === '\\' ? 2 : 1
			out += src.slice(i, j + 1)
			i = j + 1
		} else if (c === '/' && next === '/') {
			while (i < src.length && src[i] !== '\n') i++
		} else if (c === '/' && next === '*') {
			const end = src.indexOf('*/', i + 2)
			i = end === -1 ? src.length : end + 2
			out += ' '
		} else {
			out += c
			i++
		}
	}
	return out
}

/** Etherscan returns plain source, a multi-file JSON, or standard-json-input wrapped in double braces. */
export const sourceFiles = (sourceCode: string): Record<string, string> => {
	const trimmed = sourceCode.trim()
	if (!trimmed.startsWith('{')) return { 'main.sol': sourceCode }
	const json = JSON.parse(trimmed.startsWith('{{') ? trimmed.slice(1, -1) : trimmed) as Record<string, unknown>
	const sources = (json.sources ?? json) as Record<string, { content: string }>
	const files: Record<string, string> = {}
	for (const [path, file] of Object.entries(sources)) files[path] = file.content
	return files
}

/** Returns the body of `contract <name>` (inheritance targets in other files are libraries, not the deal). */
export const contractBody = (files: Record<string, string>, contractName: string): string => {
	const decl = new RegExp(`\\b(contract|abstract\\s+contract)\\s+${contractName}\\b`)
	for (const path of Object.keys(files).sort()) {
		const src = stripComments(files[path])
		const m = decl.exec(src)
		if (!m) continue
		const open = src.indexOf('{', m.index)
		const close = matchBrace(src, open)
		return src.slice(open + 1, close)
	}
	throw new Error(`contract ${contractName} not found in verified source`)
}

const matchBrace = (src: string, open: number): number => {
	let depth = 0
	for (let i = open; i < src.length; i++) {
		if (src[i] === '{') depth++
		else if (src[i] === '}' && --depth === 0) return i
	}
	throw new Error('unbalanced braces')
}

const OWNER_MODIFIER = /\bonly(Owner|Admin|Operator|Governance|Role)\b/
const OWNER_CHECK =
	/msg\.sender\s*==\s*(owner|admin|operator|_owner)\b|(owner|admin|operator)(\(\))?\s*==\s*msg\.sender|_checkOwner\s*\(|hasRole\s*\(/

export const categorize = (body: string): PowerCategory => {
	if (/\bselfdestruct\s*\(/.test(body)) return 'destroy'
	if (/\b(safeTransfer|safeTransferFrom|transfer|transferFrom)\s*\(|\.call\s*\{\s*value|\.send\s*\(/.test(body))
		return 'withdraw-funds'
	if (/\b_?(un)?pause\s*\(|\bpaused\s*=/.test(body)) return 'pause'
	if (/\bupgradeTo(AndCall)?\s*\(|\b_upgrade|\bimplementation\s*=/.test(body)) return 'upgrade'
	if (/[^=!<>]=[^=]/.test(body)) return 'modify-terms'
	return 'other'
}

/** Finds externally callable, state-changing functions that only a privileged account may call. */
export const privilegedFunctions = (body: string): PrivilegedFunction[] => {
	const out: PrivilegedFunction[] = []
	const fn = /\bfunction\s+([A-Za-z_]\w*)\s*\(/g
	for (let m = fn.exec(body); m; m = fn.exec(body)) {
		let i = m.index + m[0].length
		let depth = 1
		while (i < body.length && depth > 0) {
			if (body[i] === '(') depth++
			else if (body[i] === ')') depth--
			i++
		}
		// Header runs until the body opens (or `;` for a declaration without body).
		let j = i
		depth = 0
		while (j < body.length && !(depth === 0 && (body[j] === '{' || body[j] === ';'))) {
			if (body[j] === '(') depth++
			else if (body[j] === ')') depth--
			j++
		}
		if (body[j] !== '{') continue
		const header = body.slice(i, j)
		const close = matchBrace(body, j)
		const fnBody = body.slice(j + 1, close)
		fn.lastIndex = close

		if (!/\b(external|public)\b/.test(header)) continue
		if (/\b(view|pure)\b/.test(header)) continue

		const modifier = OWNER_MODIFIER.exec(header)
		const check = OWNER_CHECK.exec(fnBody)
		if (!modifier && !check) continue
		out.push({
			name: m[1],
			category: categorize(fnBody),
			guard: modifier ? modifier[0] : check![0].replace(/\s+/g, ' '),
		})
	}
	return out
}

export const summarizeAbi = (abiJson: string): AbiFunction[] =>
	(JSON.parse(abiJson) as Array<Record<string, any>>)
		.filter((item) => item.type === 'function')
		.map((item) => ({
			name: item.name as string,
			stateMutability: item.stateMutability as string,
			inputs: (item.inputs ?? []).length as number,
			outputs: ((item.outputs ?? []) as Array<{ type: string }>).map((o) => o.type),
		}))
		.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))

export const analyzeSource = (result: EtherscanSourceResult): SourceAnalysis => {
	if (!result.SourceCode) throw new Error('contract source is not verified on Etherscan')
	const files = sourceFiles(result.SourceCode)
	const body = contractBody(files, result.ContractName)
	return {
		contractName: result.ContractName,
		codeHash: keccak256(toBytes(result.SourceCode)),
		abi: summarizeAbi(result.ABI),
		privileged: privilegedFunctions(body),
	}
}
