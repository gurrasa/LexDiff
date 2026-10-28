// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Types, events and errors shared by LexDiffRegistry and LexDiffLogic.
interface ILexDiff {
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
}
