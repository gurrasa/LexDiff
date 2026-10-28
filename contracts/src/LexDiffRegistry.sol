// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {SignatureChecker} from "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";
import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";
import {IReceiver} from "./interfaces/IReceiver.sol";

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
///   LexDiff does not decide liability. It preserves the evidence needed to decide it.
contract LexDiffRegistry is IReceiver, EIP712 {
    // ---------------------------------------------------------------------
    // Types
    // ---------------------------------------------------------------------

    enum Kind {
        Match, //        code and agreement agree
        Mismatch, //     both define it, but differently
        Missing, //      in the agreement, not in the code
        HiddenPower //   in the code, not in the agreement
    }

    enum Status {
        None, //                 nothing to act on (a match)
        Open,
        AcceptedRisk,
        RemediationRequired,
        Resolved
    }

    enum DecisionType {
        None,
        AcceptRisk, //           client: knowingly accepts the finding
        RequireRemediation, //   reviewer: assigns the developer
        Acknowledge, //          any party: "I have seen this evidence"
        Dispute //               any party: "I contest this evidence" (reason required)
    }

    /// @notice Who may deliver reports for an agreement. Zero workflow fields are not enforced
    ///         (the CRE simulator's mock forwarder does not carry production workflow identity).
    struct Verifier {
        address forwarder;
        address workflowOwner;
        bytes32 workflowId;
    }

    /// @notice What the client and the reviewer sign before an agreement is registered.
    struct Registration {
        address client;
        address reviewer;
        address developer;
        address target;
        bytes32 termsHash; //   keccak256 of the canonical, reviewed terms JSON
        string termsURI; //     where the CRE workflow fetches the terms
        Verifier verifier;
        uint256 supersedes; //  agreement this one amends (0 = none)
        uint256 deadline;
    }

    struct Agreement {
        address client;
        address reviewer;
        address developer;
        address target; //        contract currently enforcing the agreement
        address pendingTarget; //  proposed replacement awaiting the client's acceptance
        bytes32 termsHash;
        string termsURI;
        Verifier verifier;
        uint256 supersedes;
        uint256 supersededBy;
        uint64 createdAt;
    }

    struct Check {
        address target;
        bytes32 codeHash; //     keccak256 of the verified source the workflow analysed
        bytes32 termsHash;
        bytes32 reportHash; //   keccak256 of the full off-chain report document
        bytes32 workflowId;
        address workflowOwner;
        uint64 timestamp;
        uint16 findingCount;
        uint16 nonMatchCount;
    }

    /// @dev Shape of one finding inside a CRE report. Human-readable details stay off-chain.
    struct FindingInput {
        bytes32 key;
        Kind kind;
        bytes32 detailsHash; // keccak256 of canonical {clause, expected, actual}
    }

    struct Finding {
        bytes32 key;
        Kind kind;
        Status status;
        bytes32 detailsHash; // 0 = no longer present in the code
        bytes32 evidenceHash;
        address assignee;
        uint32 firstCheck;
        uint32 lastCheck;
        uint32 resolvedInCheck;
        uint32 disputedInCheck; // last check whose evidence was disputed
        uint64 openedAt;
        uint64 resolvedAt;
    }

    struct Decision {
        DecisionType decision;
        address signer;
        bytes32 evidenceHash; // the exact finding version the signer saw
        bytes32 noteHash; //     keccak256 of the off-chain note
        bytes signature;
        uint64 timestamp;
        uint32 atCheck;
    }

    // ---------------------------------------------------------------------
    // Storage
    // ---------------------------------------------------------------------

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
    mapping(uint256 => address[]) private _contractHistory;
    mapping(uint256 => Check[]) private _checks;
    mapping(uint256 => bytes32[]) private _findingKeys;
    mapping(uint256 => mapping(bytes32 => Finding)) private _findings;
    mapping(uint256 => mapping(bytes32 => Decision[])) private _decisions;
    mapping(uint256 => mapping(bytes32 => uint32)) private _lastSeen;
    mapping(bytes32 => bool) public registrationUsed;
    mapping(address => uint256) public nonces;

    // ---------------------------------------------------------------------
    // Events / errors
    // ---------------------------------------------------------------------

    event AgreementRegistered(
        uint256 indexed agreementId,
        address indexed client,
        address indexed reviewer,
        address developer,
        bytes32 termsHash,
        uint256 supersedes
    );
    event ContractProposed(uint256 indexed agreementId, address indexed proposer, address proposed);
    event ContractUpdated(uint256 indexed agreementId, address indexed previous, address indexed current);
    /// @notice Picked up by the CRE workflow's EVM log trigger.
    event CheckRequested(uint256 indexed agreementId, address indexed target, bytes32 termsHash);
    event CheckRecorded(
        uint256 indexed agreementId, uint32 indexed checkNo, address target, bytes32 codeHash, bytes32 reportHash
    );
    event FindingOpened(uint256 indexed agreementId, bytes32 indexed key, Kind kind, bytes32 evidenceHash);
    event FindingResolved(uint256 indexed agreementId, bytes32 indexed key, uint32 checkNo, bytes32 evidenceHash);
    event FindingReopened(uint256 indexed agreementId, bytes32 indexed key, uint32 checkNo, bytes32 evidenceHash);
    event DecisionRecorded(
        uint256 indexed agreementId,
        bytes32 indexed key,
        DecisionType decision,
        address indexed signer,
        Status status,
        bytes32 noteHash
    );

    error UnknownAgreement(uint256 agreementId);
    error NotAParty(address account);
    error NotClient(address account);
    error ZeroAddress();
    error SignatureExpired();
    error InvalidSignature(address expectedSigner);
    error RegistrationReplayed();
    error CannotSupersede(uint256 agreementId);
    error NoPendingContract(address proposed);
    error NotForwarder(address sender, address expected);
    error WrongWorkflow();
    error StaleTarget(address reported, address current);
    error TermsMismatch(bytes32 reported, bytes32 current);
    error UnknownFinding(bytes32 key);
    error StaleEvidence(bytes32 signed, bytes32 current);
    error WrongRole(address signer, DecisionType decision);
    error InvalidTransition(Status status, DecisionType decision);
    error ReasonRequired();

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
        if (!SignatureChecker.isValidSignatureNow(r.client, digest, clientSig)) revert InvalidSignature(r.client);
        if (!SignatureChecker.isValidSignatureNow(r.reviewer, digest, reviewerSig)) {
            revert InvalidSignature(r.reviewer);
        }

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
        _contractHistory[agreementId].push(r.target);

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
        _contractHistory[agreementId].push(newTarget);
        emit ContractUpdated(agreementId, previous, newTarget);
        emit CheckRequested(agreementId, newTarget, a.termsHash);
    }

    function requestCheck(uint256 agreementId) external {
        Agreement storage a = _agreement(agreementId);
        if (!_isParty(a, msg.sender)) revert NotAParty(msg.sender);
        emit CheckRequested(agreementId, a.target, a.termsHash);
    }

    // ---------------------------------------------------------------------
    // 2–5. CRE report intake
    // ---------------------------------------------------------------------

    /// @inheritdoc IReceiver
    /// @dev report = abi.encode(uint256 agreementId, address target, bytes32 codeHash, bytes32 termsHash,
    ///                          bytes32 reportHash, FindingInput[])
    ///      Each report is a complete snapshot: a previously recorded finding that is absent from the report
    ///      no longer exists in the code (e.g. a removed admin function) and is treated as a match.
    function onReport(bytes calldata metadata, bytes calldata report) external override {
        (
            uint256 agreementId,
            address target,
            bytes32 codeHash,
            bytes32 termsHash,
            bytes32 reportHash,
            FindingInput[] memory inputs
        ) = abi.decode(report, (uint256, address, bytes32, bytes32, bytes32, FindingInput[]));

        Agreement storage a = _agreement(agreementId);
        (bytes32 workflowId, address workflowOwner) = _verifyReporter(a.verifier, metadata);
        if (target != a.target) revert StaleTarget(target, a.target);
        if (termsHash != a.termsHash) revert TermsMismatch(termsHash, a.termsHash);

        uint32 checkNo = uint32(_checks[agreementId].length + 1);
        bytes32 checkContext = keccak256(abi.encode(agreementId, checkNo, target, codeHash, termsHash, reportHash));
        uint16 nonMatch;

        for (uint256 i; i < inputs.length; ++i) {
            if (inputs[i].kind != Kind.Match) ++nonMatch;
            _lastSeen[agreementId][inputs[i].key] = checkNo;
            _applyFinding(agreementId, checkNo, checkContext, inputs[i]);
        }

        // Snapshot semantics: anything not reported this time is gone from the code.
        bytes32[] storage keys = _findingKeys[agreementId];
        for (uint256 i; i < keys.length; ++i) {
            if (_lastSeen[agreementId][keys[i]] == checkNo) continue;
            if (_findings[agreementId][keys[i]].kind == Kind.Match) continue;
            _applyFinding(agreementId, checkNo, checkContext, FindingInput(keys[i], Kind.Match, bytes32(0)));
        }

        _checks[agreementId].push(
            Check({
                target: target,
                codeHash: codeHash,
                termsHash: termsHash,
                reportHash: reportHash,
                workflowId: workflowId,
                workflowOwner: workflowOwner,
                timestamp: uint64(block.timestamp),
                findingCount: uint16(inputs.length),
                nonMatchCount: nonMatch
            })
        );
        emit CheckRecorded(agreementId, checkNo, target, codeHash, reportHash);
    }

    function _verifyReporter(Verifier storage v, bytes calldata metadata)
        private
        view
        returns (bytes32 workflowId, address workflowOwner)
    {
        if (msg.sender != v.forwarder) revert NotForwarder(msg.sender, v.forwarder);
        // Keystone metadata: workflowId (32) | workflowName (10) | workflowOwner (20) | reportId (2)
        if (metadata.length >= 62) {
            workflowId = bytes32(metadata[0:32]);
            workflowOwner = address(bytes20(metadata[42:62]));
        }
        if (v.workflowId != bytes32(0) && workflowId != v.workflowId) revert WrongWorkflow();
        if (v.workflowOwner != address(0) && workflowOwner != v.workflowOwner) revert WrongWorkflow();
    }

    function _applyFinding(uint256 agreementId, uint32 checkNo, bytes32 checkContext, FindingInput memory input)
        private
    {
        bytes32 evidenceHash = keccak256(abi.encode(checkContext, input.key, input.kind, input.detailsHash));
        Finding storage f = _findings[agreementId][input.key];

        if (f.firstCheck == 0) {
            _findingKeys[agreementId].push(input.key);
            f.key = input.key;
            f.firstCheck = checkNo;
            if (input.kind != Kind.Match) {
                f.status = Status.Open;
                f.openedAt = uint64(block.timestamp);
                emit FindingOpened(agreementId, input.key, input.kind, evidenceHash);
            }
        } else if (input.kind == Kind.Match) {
            if (f.status == Status.Open || f.status == Status.AcceptedRisk || f.status == Status.RemediationRequired) {
                f.status = Status.Resolved;
                f.resolvedInCheck = checkNo;
                f.resolvedAt = uint64(block.timestamp);
                emit FindingResolved(agreementId, input.key, checkNo, evidenceHash);
            }
        } else if (f.status == Status.None || f.status == Status.Resolved) {
            // Regression: something that matched (or was fixed) is wrong again.
            f.status = Status.Open;
            f.assignee = address(0);
            f.resolvedInCheck = 0;
            f.resolvedAt = 0;
            f.openedAt = uint64(block.timestamp);
            emit FindingReopened(agreementId, input.key, checkNo, evidenceHash);
        }

        f.kind = input.kind;
        f.detailsHash = input.detailsHash;
        f.evidenceHash = evidenceHash;
        f.lastCheck = checkNo;
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
        Agreement storage a = _agreement(agreementId);
        Finding storage f = _findings[agreementId][findingKey];
        if (f.firstCheck == 0) revert UnknownFinding(findingKey);
        if (f.evidenceHash != evidenceHash) revert StaleEvidence(evidenceHash, f.evidenceHash);

        bytes32 digest =
            decisionDigest(agreementId, findingKey, decision, evidenceHash, noteHash, nonces[signer], deadline);
        if (!SignatureChecker.isValidSignatureNow(signer, digest, signature)) revert InvalidSignature(signer);
        ++nonces[signer];

        if (decision == DecisionType.AcceptRisk) {
            if (signer != a.client) revert WrongRole(signer, decision);
            if (f.status != Status.Open && f.status != Status.RemediationRequired) {
                revert InvalidTransition(f.status, decision);
            }
            f.status = Status.AcceptedRisk;
            f.assignee = address(0);
        } else if (decision == DecisionType.RequireRemediation) {
            if (signer != a.reviewer) revert WrongRole(signer, decision);
            if (f.status != Status.Open && f.status != Status.AcceptedRisk) {
                revert InvalidTransition(f.status, decision);
            }
            f.status = Status.RemediationRequired;
            f.assignee = a.developer;
        } else if (decision == DecisionType.Acknowledge) {
            if (!_isParty(a, signer)) revert WrongRole(signer, decision);
            if (f.kind == Kind.Match && f.status != Status.Resolved) revert InvalidTransition(f.status, decision);
        } else if (decision == DecisionType.Dispute) {
            // Any finding may be disputed, including a match or a resolution the party disagrees with.
            if (!_isParty(a, signer)) revert WrongRole(signer, decision);
            if (noteHash == bytes32(0)) revert ReasonRequired();
            f.disputedInCheck = f.lastCheck;
        } else {
            revert InvalidTransition(f.status, decision);
        }

        _decisions[agreementId][findingKey].push(
            Decision({
                decision: decision,
                signer: signer,
                evidenceHash: evidenceHash,
                noteHash: noteHash,
                signature: signature,
                timestamp: uint64(block.timestamp),
                atCheck: f.lastCheck
            })
        );
        emit DecisionRecorded(agreementId, findingKey, decision, signer, f.status, noteHash);
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
        return _contractHistory[agreementId];
    }

    function getChecks(uint256 agreementId) external view returns (Check[] memory) {
        return _checks[agreementId];
    }

    function getFindingKeys(uint256 agreementId) external view returns (bytes32[] memory) {
        return _findingKeys[agreementId];
    }

    function getFinding(uint256 agreementId, bytes32 key) external view returns (Finding memory) {
        return _findings[agreementId][key];
    }

    function getFindings(uint256 agreementId) external view returns (Finding[] memory out) {
        bytes32[] storage keys = _findingKeys[agreementId];
        out = new Finding[](keys.length);
        for (uint256 i; i < keys.length; ++i) {
            out[i] = _findings[agreementId][keys[i]];
        }
    }

    function getDecisions(uint256 agreementId, bytes32 key) external view returns (Decision[] memory) {
        return _decisions[agreementId][key];
    }

    function supportsInterface(bytes4 interfaceId) external pure override returns (bool) {
        return interfaceId == type(IReceiver).interfaceId || interfaceId == type(IERC165).interfaceId;
    }

    // ---------------------------------------------------------------------
    // Internal
    // ---------------------------------------------------------------------

    function _agreement(uint256 agreementId) private view returns (Agreement storage a) {
        a = _agreements[agreementId];
        if (a.client == address(0)) revert UnknownAgreement(agreementId);
    }

    function _isParty(Agreement storage a, address account) private view returns (bool) {
        return account == a.client || account == a.reviewer || account == a.developer;
    }
}
