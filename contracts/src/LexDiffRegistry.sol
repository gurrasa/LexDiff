// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";
import {IReceiver} from "./interfaces/IReceiver.sol";
import {ILexDiff} from "./ILexDiff.sol";
import {LexDiffLogic} from "./LexDiffLogic.sol";

/// @title LexDiffRegistry
/// @notice Evidence ledger for agreement-vs-code comparisons.
///
///   1. What was agreed?   Client and reviewer sign the reviewed terms hash, the roles and the verifier.
///   2. Does the code match? A Chainlink CRE workflow compares and reports through the agreed forwarder.
///   3. Who knew?           Findings are anchored on-chain; parties sign Acknowledge.
///   4. Who took the risk / who fixes? Client signs Accepted risk; reviewer signs Remediation required.
///   5. Is it fixed?        Only a later report from the agreed verifier can mark a finding Resolved.
///   6. Who disputes?       Any party can sign Dispute; history is never rewritten.
///
///   Only hashes live on-chain. Finding details, notes and terms are stored off-chain and are
///   verifiable against these hashes. There is no admin: nobody, including the deployer, can change
///   an agreement's verifier after the parties signed it.
///
///   Report and decision processing live in the LexDiffLogic library (see there for why).
///
///   LexDiff does not decide liability. It preserves the evidence needed to decide it.
contract LexDiffRegistry is ILexDiff, IReceiver, EIP712 {
    bytes32 public constant VERIFIER_TYPEHASH =
        keccak256("Verifier(address forwarder,address workflowOwner,bytes32 workflowId)");
    bytes32 public constant REGISTRATION_TYPEHASH = keccak256(
        "Registration(address client,address reviewer,address developer,address target,bytes32 termsHash,string termsURI,Verifier verifier,uint256 supersedes,uint256 deadline)Verifier(address forwarder,address workflowOwner,bytes32 workflowId)"
    );
    bytes32 public constant DECISION_TYPEHASH = keccak256(
        "Decision(uint256 agreementId,bytes32 findingKey,uint8 decision,bytes32 evidenceHash,bytes32 noteHash,uint256 nonce,uint256 deadline)"
    );

    uint256 public agreementCount;
    mapping(uint256 => Agreement) private _agreements;
    mapping(uint256 => LexDiffLogic.Ledger) private _ledgers;
    mapping(bytes32 => bool) public registrationUsed;
    mapping(address => uint256) public nonces;

    constructor() EIP712("LexDiff", "1") {}

    // ---------------------------------------------------------------------
    // 1. What was agreed?
    // ---------------------------------------------------------------------

    /// @notice Register reviewed terms. Requires the client's and the reviewer's signatures over the
    ///         terms hash, the roles, the enforcing contract and the verifier. Anyone may relay.
    function registerAgreement(Registration calldata r, bytes calldata clientSig, bytes calldata reviewerSig)
        external
        returns (uint256 agreementId)
    {
        if (
            r.client == address(0) || r.reviewer == address(0) || r.developer == address(0)
                || r.target == address(0) || r.verifier.forwarder == address(0)
        ) revert ZeroAddress();
        if (block.timestamp > r.deadline) revert SignatureExpired();

        bytes32 digest = registrationDigest(r);
        if (registrationUsed[digest]) revert RegistrationReplayed();
        registrationUsed[digest] = true;
        LexDiffLogic.requireSignature(r.client, digest, clientSig);
        LexDiffLogic.requireSignature(r.reviewer, digest, reviewerSig);

        agreementId = ++agreementCount;

        if (r.supersedes != 0) {
            Agreement storage old = _agreement(r.supersedes);
            // An amendment must be consented to by the same client and reviewer.
            if (old.supersededBy != 0 || old.client != r.client || old.reviewer != r.reviewer) {
                revert CannotSupersede(r.supersedes);
            }
            old.supersededBy = agreementId;
        }

        Agreement storage a = _agreements[agreementId];
        a.client = r.client;
        a.reviewer = r.reviewer;
        a.developer = r.developer;
        a.target = r.target;
        a.termsHash = r.termsHash;
        a.termsURI = r.termsURI;
        a.verifier = r.verifier;
        a.supersedes = r.supersedes;
        a.createdAt = uint64(block.timestamp);
        _ledgers[agreementId].history.push(r.target);

        emit AgreementRegistered(agreementId, r.client, r.reviewer, r.developer, r.termsHash, r.supersedes);
        emit CheckRequested(agreementId, r.target, r.termsHash);
    }

    function registrationDigest(Registration calldata r) public view returns (bytes32) {
        return _hashTypedDataV4(
            keccak256(
                abi.encode(
                    REGISTRATION_TYPEHASH,
                    r.client,
                    r.reviewer,
                    r.developer,
                    r.target,
                    r.termsHash,
                    keccak256(bytes(r.termsURI)),
                    keccak256(
                        abi.encode(VERIFIER_TYPEHASH, r.verifier.forwarder, r.verifier.workflowOwner, r.verifier.workflowId)
                    ),
                    r.supersedes,
                    r.deadline
                )
            )
        );
    }

    // ---------------------------------------------------------------------
    // Redeployment: the developer or reviewer proposes, the client (who holds the funds) accepts.
    // ---------------------------------------------------------------------

    function proposeContract(uint256 agreementId, address newTarget) external {
        Agreement storage a = _agreement(agreementId);
        if (msg.sender != a.developer && msg.sender != a.reviewer) revert NotAParty(msg.sender);
        if (newTarget == address(0)) revert ZeroAddress();
        a.pendingTarget = newTarget;
        emit ContractProposed(agreementId, msg.sender, newTarget);
    }

    /// @param newTarget must equal the pending proposal, so the client accepts exactly what they reviewed.
    function acceptContract(uint256 agreementId, address newTarget) external {
        Agreement storage a = _agreement(agreementId);
        if (msg.sender != a.client) revert NotClient(msg.sender);
        if (newTarget == address(0) || newTarget != a.pendingTarget) revert NoPendingContract(newTarget);
        address previous = a.target;
        a.target = newTarget;
        a.pendingTarget = address(0);
        _ledgers[agreementId].history.push(newTarget);
        emit ContractUpdated(agreementId, previous, newTarget);
        emit CheckRequested(agreementId, newTarget, a.termsHash);
    }

    function requestCheck(uint256 agreementId) external {
        Agreement storage a = _agreement(agreementId);
        if (msg.sender != a.client && msg.sender != a.reviewer && msg.sender != a.developer) {
            revert NotAParty(msg.sender);
        }
        emit CheckRequested(agreementId, a.target, a.termsHash);
    }

    // ---------------------------------------------------------------------
    // 2–5. CRE report intake
    // ---------------------------------------------------------------------

    /// @inheritdoc IReceiver
    /// @dev Only the agreement's own verifier (forwarder, and pinned workflow if set) is accepted.
    function onReport(bytes calldata metadata, bytes calldata report) external override {
        uint256 agreementId = uint256(bytes32(report[0:32]));
        LexDiffLogic.applyReport(_agreement(agreementId), _ledgers[agreementId], metadata, report);
    }

    // ---------------------------------------------------------------------
    // 3, 4, 6. Signed decisions (EIP-712)
    // ---------------------------------------------------------------------

    /// @notice Record a signed decision. Anyone may relay it; the signature determines who decided.
    ///         No decision type can resolve a finding.
    /// @param evidenceHash The finding version the signer reviewed. Must be current.
    /// @param noteHash keccak256 of the off-chain note (required for Dispute).
    function submitDecision(
        uint256 agreementId,
        bytes32 findingKey,
        DecisionType decision,
        bytes32 evidenceHash,
        bytes32 noteHash,
        uint256 deadline,
        address signer,
        bytes calldata signature
    ) external {
        if (block.timestamp > deadline) revert SignatureExpired();
        bytes32 digest =
            decisionDigest(agreementId, findingKey, decision, evidenceHash, noteHash, nonces[signer]++, deadline);
        LexDiffLogic.applyDecision(
            _agreement(agreementId),
            _ledgers[agreementId],
            agreementId,
            findingKey,
            decision,
            evidenceHash,
            noteHash,
            signer,
            signature,
            digest
        );
    }

    function decisionDigest(
        uint256 agreementId,
        bytes32 findingKey,
        DecisionType decision,
        bytes32 evidenceHash,
        bytes32 noteHash,
        uint256 nonce,
        uint256 deadline
    ) public view returns (bytes32) {
        return _hashTypedDataV4(
            keccak256(
                abi.encode(
                    DECISION_TYPEHASH, agreementId, findingKey, uint8(decision), evidenceHash, noteHash, nonce, deadline
                )
            )
        );
    }

    // ---------------------------------------------------------------------
    // Views
    // ---------------------------------------------------------------------

    function getAgreement(uint256 agreementId) external view returns (Agreement memory) {
        return _agreement(agreementId);
    }

    function getContractHistory(uint256 agreementId) external view returns (address[] memory) {
        return _ledgers[agreementId].history;
    }

    function getChecks(uint256 agreementId) external view returns (Check[] memory) {
        return _ledgers[agreementId].checks;
    }

    function getFindingKeys(uint256 agreementId) external view returns (bytes32[] memory) {
        return _ledgers[agreementId].keys;
    }

    function getFinding(uint256 agreementId, bytes32 key) external view returns (Finding memory) {
        return _ledgers[agreementId].findings[key];
    }

    function getFindings(uint256 agreementId) external view returns (Finding[] memory out) {
        LexDiffLogic.Ledger storage l = _ledgers[agreementId];
        out = new Finding[](l.keys.length);
        for (uint256 i; i < l.keys.length; ++i) {
            out[i] = l.findings[l.keys[i]];
        }
    }

    function getDecisions(uint256 agreementId, bytes32 key) external view returns (Decision[] memory) {
        return _ledgers[agreementId].decisions[key];
    }

    function supportsInterface(bytes4 interfaceId) external pure override returns (bool) {
        return interfaceId == type(IReceiver).interfaceId || interfaceId == type(IERC165).interfaceId;
    }

    function _agreement(uint256 agreementId) private view returns (Agreement storage a) {
        a = _agreements[agreementId];
        if (a.client == address(0)) revert UnknownAgreement(agreementId);
    }
}
