// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Types, events and errors shared by LexDiffRegistry and LexDiffLogic.
///
/// A finding is described along four independent dimensions. None of them can stand in for another:
///   Kind         what the comparison observed           (Match / Mismatch / Missing / HiddenPower)
///   Verification the technical result of the last check (Pass / Fail / Inconclusive / NotChecked)
///   Remediation  the repair process                     (None / Required / FixProposed / FixVerified / Reopened)
///   Disposition  the parties' risk decision             (Undecided / Accepted / Rejected / Disputed)
/// Accepting a risk changes Disposition only; it never turns a Fail into a Pass. A fix is verified only when
/// the same property explicitly passes a later check. A property missing from a report becomes NotChecked.
interface ILexDiff {
    enum Kind {
        Match, //        code and agreement agree
        Mismatch, //     both define it, but differently
        Missing, //      in the agreement, not in the code
        HiddenPower //   in the code, not in the agreement
    }

    enum Verification {
        NotChecked, //   not assessed in the latest check
        Pass,
        Fail,
        Inconclusive //  assessed, but the evidence was insufficient
    }

    enum Remediation {
        None,
        Required, //     reviewer assigned a fix to the developer
        FixProposed, //  developer proposed a replacement contract
        FixVerified, //  the same property explicitly passed a later check
        Reopened //      a verified fix failed again
    }

    enum Disposition {
        Undecided,
        Accepted, //     client knowingly accepts the failing property
        Rejected, //     reviewer does not accept it (a fix is required)
        Disputed //      a party contests the finding
    }

    enum DecisionType {
        None,
        AcceptRisk, //           client
        RequireRemediation, //   reviewer; assigns the developer
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
        address freelancer; //   payee: an affected party who can acknowledge and dispute
        address target;
        bytes32 agreementHash; // keccak256 of the full signed agreement document (canonical JSON)
        bytes32 termsHash; //    keccak256 of the reviewed structured terms (canonical JSON)
        string termsURI; //      where the CRE workflow fetches the terms
        Verifier verifier;
        uint256 supersedes; //   agreement this one amends (0 = none)
        uint256 deadline;
    }

    struct Agreement {
        address client;
        address reviewer;
        address developer;
        address freelancer;
        address target; //        contract approved by the client (the one to fund)
        address pendingTarget; //  proposed replacement awaiting the client's approval
        bytes32 agreementHash;
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
        uint16 passed;
        uint16 failed;
        uint16 inconclusive;
    }

    /// @dev One assessed property inside a CRE report. Human-readable details stay off-chain.
    struct FindingInput {
        bytes32 key;
        Kind kind;
        Verification result; // Pass, Fail or Inconclusive (NotChecked is never reported)
        bytes32 detailsHash; //  keccak256 of canonical {clause, expected, actual}
    }

    struct Finding {
        bytes32 key;
        Kind kind;
        Verification verification;
        Remediation remediation;
        Disposition disposition;
        bytes32 detailsHash;
        bytes32 evidenceHash;
        address assignee;
        uint32 firstCheck;
        uint32 lastCheck; //         last check that assessed this property
        uint32 lastFailedCheck;
        uint32 fixVerifiedInCheck;
        uint32 disputedInCheck;
        uint64 openedAt;
        uint64 fixVerifiedAt;
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
    /// @notice The client approved `current` as the contract to fund. Moving funds is a separate step,
    ///         evidenced by the CRE report's balance reads, not by this event.
    event ContractApproved(uint256 indexed agreementId, address indexed previous, address indexed current);
    /// @notice Picked up by the CRE workflow's EVM log trigger.
    event CheckRequested(uint256 indexed agreementId, address indexed target, bytes32 termsHash);
    event CheckRecorded(
        uint256 indexed agreementId, uint32 indexed checkNo, address target, bytes32 codeHash, bytes32 reportHash
    );
    event FindingFailed(uint256 indexed agreementId, bytes32 indexed key, Kind kind, bytes32 evidenceHash);
    event FindingFixVerified(uint256 indexed agreementId, bytes32 indexed key, uint32 checkNo, bytes32 evidenceHash);
    event FindingReopened(uint256 indexed agreementId, bytes32 indexed key, uint32 checkNo, bytes32 evidenceHash);
    event FindingNotChecked(uint256 indexed agreementId, bytes32 indexed key, uint32 checkNo);
    event DecisionRecorded(
        uint256 indexed agreementId,
        bytes32 indexed key,
        DecisionType decision,
        address indexed signer,
        Remediation remediation,
        Disposition disposition,
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
    error InvalidResult(bytes32 key);
    error UnknownFinding(bytes32 key);
    error StaleEvidence(bytes32 signed, bytes32 current);
    error WrongRole(address signer, DecisionType decision);
    error NotApplicable(Verification verification, DecisionType decision);
    error ReasonRequired();
}
