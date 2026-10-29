import { parseAbi, parseAbiParameters } from 'viem'

export const REGISTRY_ABI = parseAbi([
	'struct Verifier { address forwarder; address workflowOwner; bytes32 workflowId; }',
	'struct Agreement { address client; address reviewer; address developer; address freelancer; address target; address pendingTarget; bytes32 agreementHash; bytes32 termsHash; string termsURI; Verifier verifier; uint256 supersedes; uint256 supersededBy; uint64 createdAt; }',
	'struct Finding { bytes32 key; uint8 kind; uint8 verification; uint8 remediation; uint8 disposition; bytes32 detailsHash; bytes32 evidenceHash; address assignee; uint32 firstCheck; uint32 lastCheck; uint32 lastFailedCheck; uint32 fixVerifiedInCheck; uint32 disputedInCheck; uint64 openedAt; uint64 fixVerifiedAt; }',
	'function getAgreement(uint256 agreementId) view returns (Agreement)',
	'function getFindings(uint256 agreementId) view returns (Finding[])',
	'function getContractHistory(uint256 agreementId) view returns (address[])',
	'event CheckRequested(uint256 indexed agreementId, address indexed target, bytes32 termsHash)',
])

export const ERC20_ABI = parseAbi([
	'function symbol() view returns (string)',
	'function balanceOf(address) view returns (uint256)',
])

/** abi.decode layout expected by LexDiffRegistry.onReport (result: 1 Pass, 2 Fail, 3 Inconclusive) */
export const REPORT_PARAMS = parseAbiParameters(
	'uint256 agreementId, address target, bytes32 codeHash, bytes32 termsHash, bytes32 reportHash, (bytes32 key, uint8 kind, uint8 result, bytes32 detailsHash)[] findings',
)
