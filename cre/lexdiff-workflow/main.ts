import {
	bytesToHex,
	consensusIdenticalAggregation,
	EVMClient,
	type EVMLog,
	encodeCallMsg,
	getNetwork,
	HTTPCapability,
	hexToBase64,
	HTTPClient,
	type HTTPPayload,
	type HTTPSendRequester,
	handler,
	LAST_FINALIZED_BLOCK_NUMBER,
	LATEST_BLOCK_NUMBER,
	logTriggerConfig,
	ok,
	prepareReportRequest,
	Runner,
	type Runtime,
	text,
	TxStatus,
} from '@chainlink/cre-sdk'
import {
	type Abi,
	type Address,
	decodeFunctionResult,
	encodeAbiParameters,
	encodeFunctionData,
	hexToBigInt,
	toHex,
	keccak256,
	toBytes,
	toEventSelector,
	zeroAddress,
} from 'viem'
import { z } from 'zod'
import { ERC20_ABI, REGISTRY_ABI, REPORT_PARAMS } from './abi.ts'
import {
	compare,
	type Finding,
	GETTER_CANDIDATES,
	type GetterTerm,
	type OnchainValues,
	removedPowers,
	resolveGetters,
} from './compare.ts'
import { buildReport } from './report.ts'
import { analyzeSource, type EtherscanSourceResult, type SourceAnalysis } from './source-analysis.ts'
import { canonicalize, type EscrowTerms, escrowTermsSchema } from './terms.ts'

const configSchema = z.object({
	chainSelectorName: z.string(),
	registryAddress: z.string(),
	etherscanApiUrl: z.string(),
	etherscanChainId: z.string(),
	evidenceStoreUrl: z.string(),
	gasLimit: z.string(),
	// Sepolia finality lags ~15 minutes. "latest" lets the demo check a contract right after it was
	// registered or replaced; production workflows should read "finalized" state.
	readFinalized: z.boolean(),
})

type Config = z.infer<typeof configSchema>

const CHECK_REQUESTED_TOPIC = toEventSelector('CheckRequested(uint256,address,bytes32)')

// ---------------------------------------------------------------------------
// Off-chain fetches (node mode, every node must return the identical string)
// ---------------------------------------------------------------------------

/** Fetches the terms JSON and returns it canonicalized, so formatting differences cannot change the hash. */
const fetchTerms = (requester: HTTPSendRequester, termsURI: string): string => {
	// The hash check makes the exact URI string irrelevant to integrity; tolerate stray whitespace in it.
	const response = requester.sendRequest({ url: termsURI.trim(), method: 'GET' }).result()
	if (!ok(response)) throw new Error(`terms fetch failed: HTTP ${response.statusCode}`)
	return canonicalize(escrowTermsSchema.parse(JSON.parse(text(response))))
}

/** Fetches verified source from Etherscan and returns the deterministic analysis (not the raw source). */
const fetchSourceAnalysis = (
	requester: HTTPSendRequester,
	config: Config,
	target: string,
	apiKey: string,
): string => {
	const url =
		`${config.etherscanApiUrl}?chainid=${config.etherscanChainId}` +
		`&module=contract&action=getsourcecode&address=${target}&apikey=${apiKey}`
	const response = requester.sendRequest({ url, method: 'GET' }).result()
	if (!ok(response)) throw new Error(`etherscan request failed: HTTP ${response.statusCode}`)
	const body = JSON.parse(text(response)) as { status: string; result: EtherscanSourceResult[] | string }
	if (body.status !== '1' || typeof body.result === 'string') {
		throw new Error(`etherscan error: ${JSON.stringify(body.result)}`)
	}
	return JSON.stringify(analyzeSource(body.result[0]))
}

/** Stores the full report off-chain. The store is content-addressed and must echo the same hash. */
const storeReport = (requester: HTTPSendRequester, url: string, canonical: string, hash: string): string => {
	const response = requester
		.sendRequest({
			url,
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: hexToBase64(toHex(toBytes(canonical))),
		})
		.result()
	if (!ok(response)) throw new Error(`evidence store failed: HTTP ${response.statusCode}`)
	const stored = (JSON.parse(text(response)) as { hash: string }).hash
	if (stored !== hash) throw new Error(`evidence store returned ${stored}, expected ${hash}`)
	return stored
}

// ---------------------------------------------------------------------------
// On-chain reads
// ---------------------------------------------------------------------------

const blockFor = (runtime: Runtime<Config>) =>
	runtime.config.readFinalized ? LAST_FINALIZED_BLOCK_NUMBER : LATEST_BLOCK_NUMBER

const callView = (runtime: Runtime<Config>, evm: EVMClient, to: string, abi: Abi, functionName: string) => {
	const reply = evm
		.callContract(runtime, {
			call: encodeCallMsg({ from: zeroAddress, to: to as Address, data: encodeFunctionData({ abi, functionName }) }),
			blockNumber: blockFor(runtime),
		})
		.result()
	return decodeFunctionResult({ abi, functionName, data: bytesToHex(reply.data) })
}

const readOnchainValues = (
	runtime: Runtime<Config>,
	evm: EVMClient,
	target: string,
	analysis: SourceAnalysis,
): OnchainValues => {
	const getters = resolveGetters(analysis.abi)
	const values: OnchainValues = {}
	for (const [term, fnName] of Object.entries(getters) as [GetterTerm, string][]) {
		const abi = [
			{
				type: 'function',
				name: fnName,
				stateMutability: 'view',
				inputs: [],
				outputs: [{ name: '', type: GETTER_CANDIDATES[term].type }],
			},
		] as const satisfies Abi
		const value = callView(runtime, evm, target, abi, fnName) as string | bigint
		runtime.log(`  ${fnName}() = ${value}`)
		;(values as Record<string, unknown>)[term] = value
	}
	if (values.token) values.tokenSymbol = callView(runtime, evm, values.token, ERC20_ABI, 'symbol') as string
	return values
}

// ---------------------------------------------------------------------------
// The check
// ---------------------------------------------------------------------------

const runCheck = (runtime: Runtime<Config>, agreementId: bigint): string => {
	const config = runtime.config
	const network = getNetwork({ chainFamily: 'evm', chainSelectorName: config.chainSelectorName, isTestnet: true })
	if (!network) throw new Error(`unknown chain ${config.chainSelectorName}`)
	const evm = new EVMClient(network.chainSelector.selector)
	const http = new HTTPClient()

	// 1. What does the registry say we are comparing?
	const a = readAgreement(runtime, evm, agreementId)
	runtime.log(`Agreement #${agreementId} -> ${a.target} (verifier ${a.verifier.forwarder})`)
	if (a.supersededBy !== 0n) runtime.log(`Note: agreement #${agreementId} is superseded by #${a.supersededBy}`)

	// 2. Agreement terms, verified against the hash registered on-chain.
	const canonicalTerms = http
		.sendRequest(runtime, fetchTerms, consensusIdenticalAggregation<string>())(a.termsURI)
		.result()
	const computedHash = keccak256(toBytes(canonicalTerms))
	if (computedHash !== a.termsHash) {
		throw new Error(`terms at ${a.termsURI} hash to ${computedHash}, registry has ${a.termsHash}`)
	}
	const terms: EscrowTerms = escrowTermsSchema.parse(JSON.parse(canonicalTerms))
	runtime.log(`Terms verified (${computedHash})`)

	// 3. Verified source code from Etherscan.
	const apiKey = runtime.getSecret({ id: 'ETHERSCAN_API_KEY' }).result().value
	const analysis: SourceAnalysis = JSON.parse(
		http
			.sendRequest(runtime, fetchSourceAnalysis, consensusIdenticalAggregation<string>())(config, a.target, apiKey)
			.result(),
	)
	runtime.log(`Source ${analysis.contractName} (${analysis.codeHash}), ${analysis.privileged.length} privileged fn(s)`)

	// 4. Actual on-chain state of the contract.
	const onchain = readOnchainValues(runtime, evm, a.target, analysis)

	// 5. Deterministic comparison, with an explicit result for every property.
	const compared = compare(terms, analysis, onchain)
	// Hidden powers found earlier that are gone now are reported as an explicit Pass of the same property.
	const previous = readRegistry(runtime, evm, 'getFindings', [agreementId]) as readonly {
		key: `0x${string}`
		kind: number
		verification: number
	}[]
	const findings = [...compared, ...removedPowers(previous, compared)]

	// Operational evidence: where the escrowed money is (approval of a contract does not move funds).
	const history = readRegistry(runtime, evm, 'getContractHistory', [agreementId]) as readonly `0x${string}`[]
	const previousTarget = history.length > 1 ? history[history.length - 2] : null
	const balanceOf = (holder: string) =>
		onchain.token ? (readTokenBalance(runtime, evm, onchain.token, holder) as bigint).toString() : '0'
	const operational = {
		target: a.target,
		targetBalance: balanceOf(a.target),
		expectedAmount: (onchain.amount ?? 0n).toString(),
		previousTarget,
		previousBalance: previousTarget ? balanceOf(previousTarget) : null,
	}
	runtime.log(`Escrow balance ${operational.targetBalance} of ${operational.expectedAmount}${previousTarget ? `, previous contract ${operational.previousBalance}` : ''}`)
	for (const f of findings) runtime.log(`  [${['', 'PASS', 'FAIL', 'INCONCLUSIVE'][f.result]} · ${['match', 'mismatch', 'missing', 'hidden power'][f.kind]}] ${f.clause}: expected ${f.expected}, actual ${f.actual}`)

	// 6. Full report off-chain (it names vulnerabilities); only hashes go on-chain.
	const report = buildReport(agreementId, a.target, a.termsHash, terms, analysis, onchain, findings, operational)
	http
		.sendRequest(runtime, storeReport, consensusIdenticalAggregation<string>())(
			config.evidenceStoreUrl,
			report.canonical,
			report.hash,
		)
		.result()
	runtime.log(`Report document stored (${report.hash})`)

	// 7. Signed report -> agreed Keystone forwarder -> LexDiffRegistry.onReport
	const payload = encodeAbiParameters(REPORT_PARAMS, [
		agreementId,
		a.target,
		analysis.codeHash,
		a.termsHash,
		report.hash,
		findings.map((f: Finding) => ({ key: f.key, kind: f.kind, result: f.result, detailsHash: f.detailsHash })),
	])
	const signed = runtime.report(prepareReportRequest(payload)).result()
	const reply = evm
		.writeReport(runtime, {
			receiver: config.registryAddress,
			report: signed,
			gasConfig: { gasLimit: config.gasLimit },
		})
		.result()
	if (reply.txStatus !== TxStatus.SUCCESS) {
		throw new Error(`writeReport failed: ${reply.errorMessage || reply.txStatus}`)
	}
	const txHash = reply.txHash ? bytesToHex(reply.txHash) : 'n/a'
	runtime.log(`Report written: ${txHash}`)
	return JSON.stringify({ agreementId: agreementId.toString(), findings: findings.length, reportHash: report.hash, txHash })
}

const readRegistry = (runtime: Runtime<Config>, evm: EVMClient, functionName: 'getFindings' | 'getContractHistory', args: [bigint]) => {
	const reply = evm
		.callContract(runtime, {
			call: encodeCallMsg({
				from: zeroAddress,
				to: runtime.config.registryAddress as Address,
				data: encodeFunctionData({ abi: REGISTRY_ABI, functionName, args }),
			}),
			blockNumber: blockFor(runtime),
		})
		.result()
	return decodeFunctionResult({ abi: REGISTRY_ABI, functionName, data: bytesToHex(reply.data) })
}

const readTokenBalance = (runtime: Runtime<Config>, evm: EVMClient, token: string, holder: string) => {
	const reply = evm
		.callContract(runtime, {
			call: encodeCallMsg({
				from: zeroAddress,
				to: token as Address,
				data: encodeFunctionData({ abi: ERC20_ABI, functionName: 'balanceOf', args: [holder as Address] }),
			}),
			blockNumber: blockFor(runtime),
		})
		.result()
	return decodeFunctionResult({ abi: ERC20_ABI, functionName: 'balanceOf', data: bytesToHex(reply.data) })
}

const readAgreement = (runtime: Runtime<Config>, evm: EVMClient, agreementId: bigint) => {
	const reply = evm
		.callContract(runtime, {
			call: encodeCallMsg({
				from: zeroAddress,
				to: runtime.config.registryAddress as Address,
				data: encodeFunctionData({ abi: REGISTRY_ABI, functionName: 'getAgreement', args: [agreementId] }),
			}),
			blockNumber: blockFor(runtime),
		})
		.result()
	return decodeFunctionResult({ abi: REGISTRY_ABI, functionName: 'getAgreement', data: bytesToHex(reply.data) })
}

// ---------------------------------------------------------------------------
// Triggers
// ---------------------------------------------------------------------------

/** HTTP trigger: {"agreementId": 1} */
const onHttpTrigger = (runtime: Runtime<Config>, payload: HTTPPayload): string => {
	const input = JSON.parse(new TextDecoder().decode(payload.input)) as { agreementId: number | string }
	return runCheck(runtime, BigInt(input.agreementId))
}

/** EVM log trigger: CheckRequested(agreementId indexed, ...) emitted on register / redeploy / request. */
const onCheckRequested = (runtime: Runtime<Config>, log: EVMLog): string => {
	const agreementId = hexToBigInt(bytesToHex(log.topics[1]))
	runtime.log(`CheckRequested for agreement #${agreementId} (tx ${bytesToHex(log.txHash)})`)
	return runCheck(runtime, agreementId)
}

const initWorkflow = (config: Config) => {
	const network = getNetwork({ chainFamily: 'evm', chainSelectorName: config.chainSelectorName, isTestnet: true })
	if (!network) throw new Error(`unknown chain ${config.chainSelectorName}`)
	const evm = new EVMClient(network.chainSelector.selector)

	return [
		handler(new HTTPCapability().trigger({}), onHttpTrigger),
		handler(
			evm.logTrigger(
				logTriggerConfig({
					addresses: [config.registryAddress as `0x${string}`],
					topics: [[CHECK_REQUESTED_TOPIC]],
				}),
			),
			onCheckRequested,
		),
	]
}

export async function main() {
	const runner = await Runner.newRunner<Config>({ configSchema })
	await runner.run(initWorkflow)
}
