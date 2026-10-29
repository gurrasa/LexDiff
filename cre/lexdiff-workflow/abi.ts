import { parseAbi, parseAbiParameters } from 'viem'

export const REGISTRY_ABI = parseAbi([
<<<<<<< HEAD
	'struct Verifier { address forwarder; address workflowOwner; bytes32 workflowId; }',
	'struct Agreement { address client; address reviewer; address developer; address target; address pendingTarget; bytes32 termsHash; string termsURI; Verifier verifier; uint256 supersedes; uint256 supersededBy; uint64 createdAt; }',
=======
	'struct Agreement { address client; address reviewer; address developer; address verifier; address target; bytes32 termsHash; string termsURI; string title; uint64 createdAt; }',
>>>>>>> df31607 (Align LexDiff with evidence-first design)
	'function getAgreement(uint256 agreementId) view returns (Agreement)',
	'event CheckRequested(uint256 indexed agreementId, address indexed target, bytes32 termsHash)',
])

export const ERC20_ABI = parseAbi(['function symbol() view returns (string)'])

/** abi.decode layout expected by LexDiffRegistry.onReport */
export const REPORT_PARAMS = parseAbiParameters(
<<<<<<< HEAD
	'uint256 agreementId, address target, bytes32 codeHash, bytes32 termsHash, bytes32 reportHash, (bytes32 key, uint8 kind, bytes32 detailsHash)[] findings',
=======
	'uint256 agreementId, address target, bytes32 codeHash, bytes32 termsHash, bytes32 reportHash, (bytes32 key, uint8 kind, bytes32 evidenceHash)[] findings',
>>>>>>> df31607 (Align LexDiff with evidence-first design)
)
