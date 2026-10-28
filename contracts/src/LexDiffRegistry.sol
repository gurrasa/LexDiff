// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {SignatureChecker} from "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";
import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";
import {IReceiver} from "./interfaces/IReceiver.sol";

/// @title LexDiffRegistry
/// @notice Evidence ledger for agreement-vs-code comparisons.
///
///         - Parties register an agreement (hash of the extracted terms) and the contract that enforces it.
///         - A Chainlink CRE workflow compares the two and delivers a report through the Keystone forwarder.
///           Every finding is stored with an evidence hash and a status.
///         - The client can sign "Accepted risk", the reviewer can sign "Remediation required" (EIP-712).
///         - Only a later CRE report can move a finding to Resolved — nobody can just claim it was fixed.
///
///         LexDiff does not decide liability. It preserves the evidence needed to decide it.
contract LexDiffRegistry is IReceiver, EIP712, Ownable {
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
        AcceptRisk, //           signed by the client
        RequireRemediation //    signed by the reviewer, assigns the developer
    }

    struct Agreement {
        address client;
        address reviewer;
        address developer;
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
        uint64 timestamp;
        uint16 findingCount;
        uint16 nonMatchCount;
    }

    /// @dev Shape of one finding inside a CRE report.
    struct FindingInput {
        bytes32 key;
        Kind kind;
        string clause;
        string expected;
        string actual;
    }

    struct Finding {
        bytes32 key;
        Kind kind;
        Status status;
        string clause;
        string expected;
        string actual;
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
        string note;
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

    /// @notice Chainlink Keystone forwarder allowed to deliver reports.
    address public forwarder;

    uint256 public agreementCount;
    mapping(uint256 => Agreement) private _agreements;
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

    event ForwarderUpdated(address indexed forwarder);
    event AgreementRegistered(
        uint256 indexed agreementId, address indexed client, address reviewer, address developer, bytes32 termsHash
    );
    event ContractUpdated(uint256 indexed agreementId, address indexed previous, address indexed current);
    /// @notice Picked up by the CRE workflow's EVM log trigger.
    event CheckRequested(uint256 indexed agreementId, address indexed target, bytes32 termsHash);
    event CheckRecorded(uint256 indexed agreementId, uint32 indexed checkNo, address target, bytes32 codeHash);
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

    constructor(address forwarder_) EIP712("LexDiff", "1") Ownable(msg.sender) {
        forwarder = forwarder_;
        emit ForwarderUpdated(forwarder_);
    }

    function setForwarder(address forwarder_) external onlyOwner {
        forwarder = forwarder_;
        emit ForwarderUpdated(forwarder_);
    }

    // ---------------------------------------------------------------------
    // Agreements
    // ---------------------------------------------------------------------

    function registerAgreement(
        address client,
        address reviewer,
        address developer,
        address target,
        bytes32 termsHash,
        string calldata termsURI,
        string calldata title
    ) external returns (uint256 agreementId) {
        if (client == address(0) || reviewer == address(0) || developer == address(0) || target == address(0)) {
            revert ZeroAddress();
        }
        agreementId = ++agreementCount;
        _agreements[agreementId] = Agreement({
            client: client,
            reviewer: reviewer,
            developer: developer,
            target: target,
            termsHash: termsHash,
            termsURI: termsURI,
            title: title,
            createdAt: uint64(block.timestamp)
        });
        _contractHistory[agreementId].push(target);
        emit AgreementRegistered(agreementId, client, reviewer, developer, termsHash);
        emit CheckRequested(agreementId, target, termsHash);
    }

    /// @notice Point the agreement at a redeployed (fixed) contract. Findings stay as they are
    ///         until the next CRE check confirms what actually changed.
    function updateContract(uint256 agreementId, address newTarget) external {
        Agreement storage a = _agreement(agreementId);
        _onlyParty(a);
        if (newTarget == address(0)) revert ZeroAddress();
        address previous = a.target;
        a.target = newTarget;
        _contractHistory[agreementId].push(newTarget);
        emit ContractUpdated(agreementId, previous, newTarget);
        emit CheckRequested(agreementId, newTarget, a.termsHash);
    }

    function requestCheck(uint256 agreementId) external {
        Agreement storage a = _agreement(agreementId);
        _onlyParty(a);
        emit CheckRequested(agreementId, a.target, a.termsHash);
    }

    // ---------------------------------------------------------------------
    // CRE report intake
    // ---------------------------------------------------------------------

    /// @inheritdoc IReceiver
    /// @dev report = abi.encode(uint256 agreementId, address target, bytes32 codeHash, bytes32 termsHash, FindingInput[])
    ///      Each report is a complete snapshot: a previously recorded finding that is absent from the report
    ///      no longer exists in the code (e.g. a removed admin function) and is treated as a match.
    function onReport(bytes calldata, bytes calldata report) external override {
        if (msg.sender != forwarder) revert NotForwarder(msg.sender);

        (uint256 agreementId, address target, bytes32 codeHash, bytes32 termsHash, FindingInput[] memory inputs) =
            abi.decode(report, (uint256, address, bytes32, bytes32, FindingInput[]));

        Agreement storage a = _agreement(agreementId);
        if (target != a.target) revert StaleTarget(target, a.target);
        if (termsHash != a.termsHash) revert TermsMismatch(termsHash, a.termsHash);

        uint32 checkNo = uint32(_checks[agreementId].length + 1);
        uint16 nonMatch;

        for (uint256 i; i < inputs.length; ++i) {
            FindingInput memory input = inputs[i];
            if (input.kind != Kind.Match) ++nonMatch;
            _lastSeen[agreementId][input.key] = checkNo;
            _applyFinding(agreementId, checkNo, target, codeHash, termsHash, input);
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
                target,
                codeHash,
                termsHash,
                FindingInput({key: f.key, kind: Kind.Match, clause: f.clause, expected: f.expected, actual: "not present in code"})
            );
        }

        _checks[agreementId].push(
            Check({
                target: target,
                codeHash: codeHash,
                termsHash: termsHash,
                timestamp: uint64(block.timestamp),
                findingCount: uint16(inputs.length),
                nonMatchCount: nonMatch
            })
        );
        emit CheckRecorded(agreementId, checkNo, target, codeHash);
    }

    function _applyFinding(
        uint256 agreementId,
        uint32 checkNo,
        address target,
        bytes32 codeHash,
        bytes32 termsHash,
        FindingInput memory input
    ) private {
        bytes32 evidenceHash = keccak256(
            abi.encode(
                agreementId, checkNo, target, codeHash, termsHash, input.key, input.kind, input.expected, input.actual
            )
        );
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
        f.clause = input.clause;
        f.expected = input.expected;
        f.actual = input.actual;
        f.evidenceHash = evidenceHash;
        f.lastCheck = checkNo;
    }

    // ---------------------------------------------------------------------
    // Signed decisions (EIP-712)
    // ---------------------------------------------------------------------

    /// @notice Record a signed decision. Anyone may relay it; the signature determines who decided.
    /// @param signer   The party that signed (EOA or ERC-1271 smart account).
    /// @param evidenceHash The evidence hash of the finding version the signer reviewed. Must be current,
    ///                 so a signature can never be applied to a finding that changed after it was signed.
    function submitDecision(
        uint256 agreementId,
        bytes32 findingKey,
        DecisionType decision,
        bytes32 evidenceHash,
        string calldata note,
        uint256 deadline,
        address signer,
        bytes calldata signature
    ) external {
        if (block.timestamp > deadline) revert SignatureExpired();
        Agreement storage a = _agreement(agreementId);
        Finding storage f = _findings[agreementId][findingKey];
        if (f.firstCheck == 0) revert UnknownFinding(findingKey);
        if (f.evidenceHash != evidenceHash) revert StaleEvidence(evidenceHash, f.evidenceHash);

        bytes32 digest = decisionDigest(
            agreementId, findingKey, decision, evidenceHash, keccak256(bytes(note)), nonces[signer], deadline
        );
        if (!SignatureChecker.isValidSignatureNow(signer, digest, signature)) revert InvalidSignature();
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
        } else {
            revert InvalidTransition(f.status, decision);
        }

        _decisions[agreementId][findingKey].push(
            Decision({
                decision: decision,
                signer: signer,
                evidenceHash: evidenceHash,
                note: note,
                signature: signature,
                timestamp: uint64(block.timestamp),
                atCheck: f.lastCheck
            })
        );
        emit DecisionRecorded(agreementId, findingKey, decision, signer, f.status);
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

    function _onlyParty(Agreement storage a) private view {
        if (msg.sender != a.client && msg.sender != a.reviewer && msg.sender != a.developer) {
            revert NotAParty(msg.sender);
        }
    }
}
