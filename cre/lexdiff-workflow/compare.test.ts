import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { compare, coverage, detailsHash, findingKey, Kind, resolveGetters } from './compare.ts'
import { buildReport } from './report.ts'
import { analyzeSource, privilegedFunctions, stripComments } from './source-analysis.ts'
import { canonicalize, escrowTermsSchema, termsHash } from './terms.ts'

const root = new URL('../../', import.meta.url)
const read = (path: string) => readFileSync(new URL(path, root), 'utf8')

const CLIENT = '0x1111111111111111111111111111111111111111'
const FREELANCER = '0x2222222222222222222222222222222222222222'
const TOKEN = '0x3333333333333333333333333333333333333333'

const terms = escrowTermsSchema.parse({
	...JSON.parse(read('agreements/freelance-escrow.terms.example.json')),
	parties: { client: { name: 'Acme', wallet: CLIENT }, freelancer: { name: 'Jane', wallet: FREELANCER } },
})

// ABI as Etherscan would return it for the demo escrows.
const abiFor = (withRefund: boolean) =>
	JSON.stringify([
		...['client', 'freelancer', 'token'].map((name) => ({
			type: 'function', name, stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }],
		})),
		...['amount', 'deliveryPeriod', 'reviewPeriod', 'fundedAt', 'deliveredAt'].map((name) => ({
			type: 'function', name, stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }],
		})),
		...['fund', 'markDelivered', 'approve', 'claimAfterReview', ...(withRefund ? ['refund'] : [])].map((name) => ({
			type: 'function', name, stateMutability: 'nonpayable', inputs: [], outputs: [],
		})),
		{ type: 'function', name: 'emergencyWithdraw', stateMutability: 'nonpayable', inputs: [{ type: 'address' }], outputs: [] },
	])

const analysisFor = (file: string, name: string, withRefund: boolean) =>
	analyzeSource({ SourceCode: read(`contracts/src/demo/${file}`), ABI: abiFor(withRefund), ContractName: name })

const onchain = (deliveryDays: bigint) => ({
	client: CLIENT,
	freelancer: FREELANCER,
	token: TOKEN,
	tokenSymbol: 'mUSDC',
	amount: 1_000_000_000n,
	deliveryPeriod: deliveryDays * 86400n,
	reviewPeriod: 7n * 86400n,
})

const byClause = (findings: ReturnType<typeof compare>) => Object.fromEntries(findings.map((f) => [f.clause, f]))

test('V1 reproduces the three demo findings', () => {
	const analysis = analysisFor('FreelanceEscrowV1.sol', 'FreelanceEscrowV1', false)
	const f = byClause(compare(terms, analysis, onchain(3n)))

	assert.equal(f['Delivery deadline'].kind, Kind.Mismatch)
	assert.equal(f['Delivery deadline'].expected, '30 days')
	assert.equal(f['Delivery deadline'].actual, '3 days')
	assert.equal(f['Refund if deadline is missed'].kind, Kind.Missing)
	assert.equal(f['Admin power: withdraw-funds'].kind, Kind.HiddenPower)
	assert.match(f['Admin power: withdraw-funds'].actual, /emergencyWithdraw\(\) guarded by onlyOwner/)

	for (const clause of ['Client (depositor)', 'Freelancer (payee)', 'Payment token', 'Escrow amount', 'Client review period']) {
		assert.equal(f[clause].kind, Kind.Match, clause)
	}
})

test('V2 fixes deadline and refund, keeps the withdrawal power', () => {
	const analysis = analysisFor('FreelanceEscrowV2.sol', 'FreelanceEscrowV2', true)
	const f = byClause(compare(terms, analysis, onchain(30n)))
	assert.equal(f['Delivery deadline'].kind, Kind.Match)
	assert.equal(f['Refund if deadline is missed'].kind, Kind.Match)
	assert.equal(f['Admin power: withdraw-funds'].kind, Kind.HiddenPower)
})

test('refund must check the deadline and pay the client', () => {
	const badSource = `contract BadEscrow {
		function refund() external { token.safeTransfer(freelancer, amount); }
	}`
	const analysis = analyzeSource({ SourceCode: badSource, ABI: abiFor(true), ContractName: 'BadEscrow' })
	const f = byClause(compare(terms, analysis, onchain(30n)))
	assert.equal(f['Refund if deadline is missed'].kind, Kind.Mismatch)
	assert.match(f['Refund if deadline is missed'].actual, /deadline check/)
	assert.match(f['Refund if deadline is missed'].actual, /transfer to client/)
})

test('finding keys are stable across versions', () => {
	const v1 = compare(terms, analysisFor('FreelanceEscrowV1.sol', 'FreelanceEscrowV1', false), onchain(3n))
	const v2 = compare(terms, analysisFor('FreelanceEscrowV2.sol', 'FreelanceEscrowV2', true), onchain(30n))
	assert.deepEqual(v1.map((f) => f.key), v2.map((f) => f.key))
	assert.equal(v1.find((f) => f.clause === 'Delivery deadline')!.key, findingKey('term:deliveryPeriod'))
})

test('a power granted by the agreement is a match', () => {
	const granted = { ...terms, adminPowers: [{ category: 'withdraw-funds' as const, description: 'operator may recover funds' }] }
	const f = byClause(compare(granted, analysisFor('FreelanceEscrowV1.sol', 'FreelanceEscrowV1', false), onchain(3n)))
	assert.equal(f['Admin power: withdraw-funds'].kind, Kind.Match)
})

test('missing getters are reported as missing', () => {
	const f = byClause(compare(terms, analysisFor('FreelanceEscrowV1.sol', 'FreelanceEscrowV1', false), {}))
	assert.equal(f['Delivery deadline'].kind, Kind.Missing)
	assert.equal(f['Escrow amount'].kind, Kind.Missing)
})

test('privileged functions: modifiers, inline checks, comments and client-only functions', () => {
	const body = stripComments(`
		// function fake() external onlyOwner { token.transfer(a, 1); }
		function sweep(address to) external { require(msg.sender == owner, "x"); payable(to).transfer(address(this).balance); }
		function setFee(uint256 f) public onlyAdmin { fee = f; }
		function pause() external onlyOwner { _pause(); }
		function fund() external { require(msg.sender == client); token.safeTransferFrom(msg.sender, address(this), 1); }
		function quote() external view onlyOwner returns (uint256) { return 1; }
	`)
	assert.deepEqual(
		privilegedFunctions(body).map((p) => [p.name, p.category]),
		[['sweep', 'withdraw-funds'], ['setFee', 'modify-terms'], ['pause', 'pause']],
	)
})

test('standard-json-input from Etherscan is unwrapped', () => {
	const source = read('contracts/src/demo/FreelanceEscrowV1.sol')
	const wrapped = `{${JSON.stringify({ language: 'Solidity', sources: { 'src/demo/FreelanceEscrowV1.sol': { content: source }, 'lib/Ownable.sol': { content: 'abstract contract Ownable { function renounceOwnership() public onlyOwner { _owner = address(0); } }' } } })}}`
	const analysis = analyzeSource({ SourceCode: wrapped, ABI: abiFor(false), ContractName: 'FreelanceEscrowV1' })
	assert.deepEqual(analysis.privileged.map((p) => p.name), ['emergencyWithdraw'])
})

test('getters resolve by name and type', () => {
	const getters = resolveGetters(JSON.parse(abiFor(false)).map((f: any) => ({
		name: f.name, stateMutability: f.stateMutability, inputs: f.inputs.length, outputs: f.outputs.map((o: any) => o.type),
	})))
	assert.equal(getters.deliveryPeriod, 'deliveryPeriod')
	assert.equal(getters.client, 'client')
})

test('terms hash ignores key order and whitespace', () => {
	const reordered = JSON.parse(JSON.stringify(Object.fromEntries(Object.entries(terms).reverse()), null, 4))
	assert.equal(canonicalize(reordered), canonicalize(terms))
	assert.equal(termsHash(escrowTermsSchema.parse(reordered)), termsHash(terms))
})

test('report document: only hashes reach the chain, details are recoverable off-chain', () => {
	const analysis = analysisFor('FreelanceEscrowV1.sol', 'FreelanceEscrowV1', false)
	const findings = compare(terms, analysis, onchain(3n))
	const deadline = findings.find((f) => f.clause === 'Delivery deadline')!
	assert.equal(deadline.detailsHash, detailsHash('Delivery deadline', '30 days', '3 days'))

	const a = buildReport(1n, TOKEN, termsHash(terms), terms, analysis, onchain(3n), findings)
	const b = buildReport(1n, TOKEN, termsHash(terms), terms, analysis, onchain(3n), [...findings])
	assert.equal(a.hash, b.hash)
	const doc = JSON.parse(a.canonical)
	assert.equal(doc.findings.length, findings.length)
	assert.equal(doc.onchain.deliveryPeriod, String(3n * 86400n))
})

test('every finding says how it was checked, and unchecked terms are listed', () => {
	const findings = compare(terms, analysisFor('FreelanceEscrowV1.sol', 'FreelanceEscrowV1', false), onchain(3n))
	const f = byClause(findings)
	assert.equal(f['Delivery deadline'].level, 'value')
	assert.equal(f['Refund if deadline is missed'].level, 'structural')
	assert.equal(f['Admin power: withdraw-funds'].level, 'structural')
	for (const x of findings) assert.ok(x.method.length > 0, x.clause)

	const c = coverage(terms, findings)
	assert.equal(c.checked, 7)
	assert.equal(c.byLevel.value + c.byLevel.structural, findings.length)
	assert.equal(c.unchecked.length, terms.payoutConditions.length)
	assert.match(c.unchecked[0].reason, /not checked automatically/)
})

test('second agreement: granted pause is a match, unlisted deadline setter is a hidden power', () => {
	const website = escrowTermsSchema.parse({
		...JSON.parse(read('agreements/website-redesign.terms.example.json')),
		parties: { client: { name: 'Nordic', wallet: CLIENT }, freelancer: { name: 'Pixel', wallet: FREELANCER } },
	})
	const analysis = analysisFor('WebsiteEscrow.sol', 'WebsiteEscrow', true)
	const f = byClause(
		compare(website, analysis, { ...onchain(14n), amount: 2_500_000_000n, reviewPeriod: 2n * 86400n }),
	)
	assert.equal(f['Escrow amount'].kind, Kind.Match)
	assert.equal(f['Delivery deadline'].kind, Kind.Match)
	assert.equal(f['Client review period'].kind, Kind.Mismatch)
	assert.equal(f['Client review period'].actual, '2 days')
	assert.equal(f['Refund if deadline is missed'].kind, Kind.Match)
	assert.equal(f['Admin power: pause'].kind, Kind.Match)
	assert.equal(f['Admin power: modify-terms'].kind, Kind.HiddenPower)
	assert.match(f['Admin power: modify-terms'].actual, /setDeliveryPeriod/)
})
