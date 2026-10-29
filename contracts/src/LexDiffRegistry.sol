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
<<<<<<< HEAD
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

=======
///         - Client and reviewer approve an agreement hash, its verifier, and the contract that enforces it.
///         - A Chainlink CRE workflow compares the two and delivers a report through the Keystone forwarder.
///           Every finding is stored with an evidence hash and a status.
///         - Parties can acknowledge or dispute; the client can accept risk and the reviewer can require remediation.
///         - Only a later CRE report can move a finding to Resolved — nobody can just claim it was fixed.
///
///         LexDiff does not decide liability. It preserves the evidence needed to decide it.
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
        Acknowledge, //           signed by any agreement party; status unchanged
        AcceptRisk, //           signed by the client
        RequireRemediation, //   signed by the reviewer, assigns the developer
        Dispute //                signed by any agreement party; status unchanged
    }

    struct Agreement {
        address client;
        address reviewer;
        address developer;
        address verifier; //     immutable CRE forwarder for this agreement
        address target; //       contract currently claimed to implement the agreement
        bytes32 termsHash; //    keccak256 of the canonical terms JSON
        string termsURI; //      where the CRE workflow fetches the terms
        string title;
        uint64 createdAt;
    }

    struct Check {
        address target;
        bytes32 codeHash; //     keccak256 of the verified source the workflow analysed
        bytes32 termsHash;
        bytes32 reportHash; //    canonical off-chain evidence report
        uint64 timestamp;
        uint16 findingCount;
        uint16 nonMatchCount;
    }

    /// @dev Shape of one finding inside a CRE report.
    struct FindingInput {
        bytes32 key;
        Kind kind;
        bytes32 evidenceHash;
    }

    struct Finding {
        bytes32 key;
        Kind kind;
        Status status;
        bytes32 evidenceHash;
        address assignee;
        uint32 firstCheck;
        uint32 lastCheck;
        uint32 resolvedInCheck;
        uint64 openedAt;
        uint64 resolvedAt;
    }

    struct Decision {
        DecisionType decision;
        address signer;
        bytes32 evidenceHash; // the exact finding version the signer saw
        bytes32 noteHash; //     note content stays in the off-chain evidence store
        bytes signature;
        uint64 timestamp;
        uint32 atCheck;
    }

    // ---------------------------------------------------------------------
    // Storage
    // ---------------------------------------------------------------------

    bytes32 public constant DECISION_TYPEHASH = keccak256(
        "Decision(uint256 agreementId,bytes32 findingKey,uint8 decision,bytes32 evidenceHash,bytes32 noteHash,uint256 nonce,uint256 deadline)"
    );
    bytes32 public constant AGREEMENT_APPROVAL_TYPEHASH = keccak256(
        "AgreementApproval(address client,address reviewer,address developer,address target,address verifier,bytes32 termsHash,bytes32 termsURIHash,bytes32 titleHash,uint256 nonce,uint256 deadline)"
    );

    uint256 public agreementCount;
    mapping(uint256 => Agreement) private _agreements;
    mapping(uint256 => address) public pendingTargets;
    mapping(uint256 => address[]) private _contractHistory;
    mapping(uint256 => Check[]) private _checks;
    mapping(uint256 => bytes32[]) private _findingKeys;
    mapping(uint256 => mapping(bytes32 => Finding)) private _findings;
    mapping(uint256 => mapping(bytes32 => Decision[])) private _decisions;
    mapping(uint256 => mapping(bytes32 => uint32)) private _lastSeen;
    mapping(address => uint256) public nonces;

    // ---------------------------------------------------------------------
    // Events / errors
    // ---------------------------------------------------------------------

    event AgreementRegistered(
        uint256 indexed agreementId,
        address indexed client,
        address reviewer,
        address developer,
        address verifier,
        bytes32 termsHash
    );
    event ContractProposed(uint256 indexed agreementId, address indexed developer, address indexed proposed);
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
        uint256 indexed agreementId, bytes32 indexed key, DecisionType decision, address indexed signer, Status status
    );

    error NotForwarder(address sender);
    error UnknownAgreement(uint256 agreementId);
    error NotAParty(address sender);
    error StaleTarget(address reported, address current);
    error TermsMismatch(bytes32 reported, bytes32 current);
    error UnknownFinding(bytes32 key);
    error InvalidSignature();
    error SignatureExpired();
    error WrongRole(address signer, DecisionType decision);
    error InvalidTransition(Status status, DecisionType decision);
    error StaleEvidence(bytes32 signed, bytes32 current);
    error ZeroAddress();
    error NotDeveloper(address sender);
    error NotClient(address sender);
    error NoPendingContract();
    error EmptyDisputeReason();
    error ZeroEvidenceHash(bytes32 key);

>>>>>>> df31607 (Align LexDiff with evidence-first design)
    constructor() EIP712("LexDiff", "1") {}

    // ---------------------------------------------------------------------
    // 1. What was agreed?
    // ---------------------------------------------------------------------

<<<<<<< HEAD
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
=======
    function registerAgreement(
        address client,
        address reviewer,
        address developer,
        address target,
        address verifier,
        bytes32 termsHash,
        string calldata termsURI,
        string calldata title,
        uint256 deadline,
        bytes calldata clientSignature,
        bytes calldata reviewerSignature
    ) external returns (uint256 agreementId) {
        if (
            client == address(0) || reviewer == address(0) || developer == address(0) || target == address(0)
                || verifier == address(0)
        ) {
            revert ZeroAddress();
        }
        if (block.timestamp > deadline) revert SignatureExpired();
        bytes32 clientDigest = agreementApprovalDigest(
            client, reviewer, developer, target, verifier, termsHash, termsURI, title, nonces[client], deadline
        );
        bytes32 reviewerDigest = agreementApprovalDigest(
            client, reviewer, developer, target, verifier, termsHash, termsURI, title, nonces[reviewer], deadline
        );
        if (!SignatureChecker.isValidSignatureNow(client, clientDigest, clientSignature)) revert InvalidSignature();
        if (!SignatureChecker.isValidSignatureNow(reviewer, reviewerDigest, reviewerSignature)) revert InvalidSignature();
        ++nonces[client];
        ++nonces[reviewer];
        agreementId = ++agreementCount;
        _agreements[agreementId] = Agreement({
            client: client,
            reviewer: reviewer,
            developer: developer,
            verifier: verifier,
            target: target,
            termsHash: termsHash,
            termsURI: termsURI,
            title: title,
            createdAt: uint64(block.timestamp)
        });
        _contractHistory[agreementId].push(target);
        emit AgreementRegistered(agreementId, client, reviewer, developer, verifier, termsHash);
        emit CheckRequested(agreementId, target, termsHash);
    }

    function agreementApprovalDigest(
        address client,
        address reviewer,
        address developer,
        address target,
        address verifier,
        bytes32 termsHash,
        string calldata termsURI,
        string calldata title,
        uint256 nonce,
        uint256 deadline
    ) public view returns (bytes32) {
        return _hashTypedDataV4(
            keccak256(
                abi.encode(
                    AGREEMENT_APPROVAL_TYPEHASH,
                    client,
                    reviewer,
                    developer,
                    target,
                    verifier,
                    termsHash,
                    keccak256(bytes(termsURI)),
                    keccak256(bytes(title)),
                    nonce,
                    deadline
>>>>>>> df31607 (Align LexDiff with evidence-first design)
                )
            )
        );
    }

<<<<<<< HEAD
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
=======
    /// @notice The developer proposes code; it has no effect until the client accepts it.
    function proposeContract(uint256 agreementId, address newTarget) external {
        Agreement storage a = _agreement(agreementId);
        if (msg.sender != a.developer) revert NotDeveloper(msg.sender);
        if (newTarget == address(0)) revert ZeroAddress();
        pendingTargets[agreementId] = newTarget;
        emit ContractProposed(agreementId, msg.sender, newTarget);
    }

    function acceptContract(uint256 agreementId) external {
        Agreement storage a = _agreement(agreementId);
        if (msg.sender != a.client) revert NotClient(msg.sender);
        address newTarget = pendingTargets[agreementId];
        if (newTarget == address(0)) revert NoPendingContract();
        address previous = a.target;
        a.target = newTarget;
        delete pendingTargets[agreementId];
        _contractHistory[agreementId].push(newTarget);
>>>>>>> df31607 (Align LexDiff with evidence-first design)
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
<<<<<<< HEAD
    /// @dev Only the agreement's own verifier (forwarder, and pinned workflow if set) is accepted.
    function onReport(bytes calldata metadata, bytes calldata report) external override {
        uint256 agreementId = uint256(bytes32(report[0:32]));
        LexDiffLogic.applyReport(_agreement(agreementId), _ledgers[agreementId], metadata, report);
=======
    /// @dev report = abi.encode(uint256 agreementId, address target, bytes32 codeHash, bytes32 termsHash,
    ///                          bytes32 reportHash, FindingInput[]). Finding text stays off-chain.
    ///      Each report is a complete snapshot: a previously recorded finding that is absent from the report
    ///      no longer exists in the code (e.g. a removed admin function) and is treated as a match.
    function onReport(bytes calldata, bytes calldata report) external override {
        (
            uint256 agreementId,
            address target,
            bytes32 codeHash,
            bytes32 termsHash,
            bytes32 reportHash,
            FindingInput[] memory inputs
        ) = abi.decode(report, (uint256, address, bytes32, bytes32, bytes32, FindingInput[]));

        Agreement storage a = _agreement(agreementId);
        if (msg.sender != a.verifier) revert NotForwarder(msg.sender);
        if (target != a.target) revert StaleTarget(target, a.target);
        if (termsHash != a.termsHash) revert TermsMismatch(termsHash, a.termsHash);

        uint32 checkNo = uint32(_checks[agreementId].length + 1);
        uint16 nonMatch;

        for (uint256 i; i < inputs.length; ++i) {
            FindingInput memory input = inputs[i];
            if (input.evidenceHash == bytes32(0)) revert ZeroEvidenceHash(input.key);
            if (input.kind != Kind.Match) ++nonMatch;
            _lastSeen[agreementId][input.key] = checkNo;
            _applyFinding(agreementId, checkNo, input);
        }

        // Snapshot semantics: anything not reported this time is gone from the code.
        bytes32[] storage keys = _findingKeys[agreementId];
        for (uint256 i; i < keys.length; ++i) {
            if (_lastSeen[agreementId][keys[i]] == checkNo) continue;
            Finding storage f = _findings[agreementId][keys[i]];
            if (f.kind == Kind.Match) continue;
            _applyFinding(
                agreementId,
                checkNo,
                FindingInput({
                    key: f.key,
                    kind: Kind.Match,
                    evidenceHash: keccak256(abi.encode(reportHash, f.key, Kind.Match))
                })
            );
        }

        _checks[agreementId].push(
            Check({
                target: target,
                codeHash: codeHash,
                termsHash: termsHash,
                reportHash: reportHash,
                timestamp: uint64(block.timestamp),
                findingCount: uint16(inputs.length),
                nonMatchCount: nonMatch
            })
        );
        emit CheckRecorded(agreementId, checkNo, target, codeHash, reportHash);
    }

    function _applyFinding(
        uint256 agreementId,
        uint32 checkNo,
        FindingInput memory input
    ) private {
        bytes32 evidenceHash = input.evidenceHash;
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
        f.evidenceHash = evidenceHash;
        f.lastCheck = checkNo;
>>>>>>> df31607 (Align LexDiff with evidence-first design)
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
<<<<<<< HEAD
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
=======
        Agreement storage a = _agreement(agreementId);
        Finding storage f = _findings[agreementId][findingKey];
        if (f.firstCheck == 0) revert UnknownFinding(findingKey);
        if (f.evidenceHash != evidenceHash) revert StaleEvidence(evidenceHash, f.evidenceHash);

        bytes32 digest = decisionDigest(
            agreementId, findingKey, decision, evidenceHash, noteHash, nonces[signer], deadline
        );
        if (!SignatureChecker.isValidSignatureNow(signer, digest, signature)) revert InvalidSignature();
        ++nonces[signer];

        if (decision == DecisionType.Acknowledge || decision == DecisionType.Dispute) {
            if (signer != a.client && signer != a.reviewer && signer != a.developer) revert NotAParty(signer);
            if (f.status == Status.None || f.status == Status.Resolved) revert InvalidTransition(f.status, decision);
            if (decision == DecisionType.Dispute && noteHash == bytes32(0)) revert EmptyDisputeReason();
            // Evidence-bound acknowledgement/dispute is preserved without deciding or rewriting status.
        } else if (decision == DecisionType.AcceptRisk) {
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
        emit DecisionRecorded(agreementId, findingKey, decision, signer, f.status);
>>>>>>> df31607 (Align LexDiff with evidence-first design)
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
