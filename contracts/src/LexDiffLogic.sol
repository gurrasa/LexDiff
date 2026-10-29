// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {SignatureChecker} from "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";
import {ILexDiff} from "./ILexDiff.sol";

/// @title LexDiffLogic
/// @notice The heavy logic of LexDiffRegistry, deployed as a separate library and run via DELEGATECALL
///         on the registry's own storage. Split out because Sepolia's per-byte code deposit cost puts a
///         single contract over the 16.7M transaction gas cap (EIP-7825).
library LexDiffLogic {
    /// @notice Everything recorded for one agreement.
    struct Ledger {
        address[] history; // contracts approved by the client, oldest first
        ILexDiff.Check[] checks;
        bytes32[] keys;
        mapping(bytes32 => ILexDiff.Finding) findings;
        mapping(bytes32 => ILexDiff.Decision[]) decisions;
        mapping(bytes32 => uint32) lastSeen;
    }

    function requireSignature(address signer, bytes32 digest, bytes calldata signature) external view {
        if (!SignatureChecker.isValidSignatureNow(signer, digest, signature)) revert ILexDiff.InvalidSignature(signer);
    }

    // ---------------------------------------------------------------------
    // CRE reports
    // ---------------------------------------------------------------------

    /// @dev report = abi.encode(uint256 agreementId, address target, bytes32 codeHash, bytes32 termsHash,
    ///                          bytes32 reportHash, FindingInput[])
    ///      Every input carries an explicit result. A previously recorded property that is absent from the
    ///      report was not assessed: it becomes NotChecked and is never treated as fixed.
    function applyReport(ILexDiff.Agreement storage a, Ledger storage l, bytes calldata metadata, bytes calldata report)
        external
    {
        (
            uint256 agreementId,
            address target,
            bytes32 codeHash,
            bytes32 termsHash,
            bytes32 reportHash,
            ILexDiff.FindingInput[] memory inputs
        ) = abi.decode(report, (uint256, address, bytes32, bytes32, bytes32, ILexDiff.FindingInput[]));

        (bytes32 workflowId, address workflowOwner) = _verifyReporter(a.verifier, metadata);
        if (target != a.target) revert ILexDiff.StaleTarget(target, a.target);
        if (termsHash != a.termsHash) revert ILexDiff.TermsMismatch(termsHash, a.termsHash);

        uint32 checkNo = uint32(l.checks.length + 1);
        bytes32 checkContext = keccak256(abi.encode(agreementId, checkNo, target, codeHash, termsHash, reportHash));
        uint16[4] memory counts; // indexed by Verification

        for (uint256 i; i < inputs.length; ++i) {
            ILexDiff.Verification result = inputs[i].result;
            if (result == ILexDiff.Verification.NotChecked) revert ILexDiff.InvalidResult(inputs[i].key);
            ++counts[uint8(result)];
            l.lastSeen[inputs[i].key] = checkNo;
            _applyFinding(l, agreementId, checkNo, checkContext, inputs[i]);
        }

        // Properties not assessed this time keep their history but lose their current result.
        for (uint256 i; i < l.keys.length; ++i) {
            bytes32 key = l.keys[i];
            ILexDiff.Finding storage f = l.findings[key];
            if (l.lastSeen[key] == checkNo || f.verification == ILexDiff.Verification.NotChecked) continue;
            f.verification = ILexDiff.Verification.NotChecked;
            emit ILexDiff.FindingNotChecked(agreementId, key, checkNo);
        }

        l.checks.push(
            ILexDiff.Check({
                target: target,
                codeHash: codeHash,
                termsHash: termsHash,
                reportHash: reportHash,
                workflowId: workflowId,
                workflowOwner: workflowOwner,
                timestamp: uint64(block.timestamp),
                passed: counts[uint8(ILexDiff.Verification.Pass)],
                failed: counts[uint8(ILexDiff.Verification.Fail)],
                inconclusive: counts[uint8(ILexDiff.Verification.Inconclusive)]
            })
        );
        emit ILexDiff.CheckRecorded(agreementId, checkNo, target, codeHash, reportHash);
    }

    function _verifyReporter(ILexDiff.Verifier storage v, bytes calldata metadata)
        private
        view
        returns (bytes32 workflowId, address workflowOwner)
    {
        // Under DELEGATECALL, msg.sender is still the caller of the registry.
        if (msg.sender != v.forwarder) revert ILexDiff.NotForwarder(msg.sender, v.forwarder);
        // Keystone metadata: workflowId (32) | workflowName (10) | workflowOwner (20) | reportId (2)
        if (metadata.length >= 62) {
            workflowId = bytes32(metadata[0:32]);
            workflowOwner = address(bytes20(metadata[42:62]));
        }
        if (v.workflowId != bytes32(0) && workflowId != v.workflowId) revert ILexDiff.WrongWorkflow();
        if (v.workflowOwner != address(0) && workflowOwner != v.workflowOwner) revert ILexDiff.WrongWorkflow();
    }

    function _applyFinding(
        Ledger storage l,
        uint256 agreementId,
        uint32 checkNo,
        bytes32 checkContext,
        ILexDiff.FindingInput memory input
    ) private {
        bytes32 evidenceHash =
            keccak256(abi.encode(checkContext, input.key, input.kind, input.result, input.detailsHash));
        ILexDiff.Finding storage f = l.findings[input.key];

        if (f.firstCheck == 0) {
            l.keys.push(input.key);
            f.key = input.key;
            f.firstCheck = checkNo;
        }

        if (input.result == ILexDiff.Verification.Fail) {
            if (f.remediation == ILexDiff.Remediation.FixVerified) {
                // A verified fix regressed.
                f.remediation = ILexDiff.Remediation.Reopened;
                emit ILexDiff.FindingReopened(agreementId, input.key, checkNo, evidenceHash);
            } else if (f.remediation == ILexDiff.Remediation.FixProposed) {
                // The proposed replacement did not fix it: the fix is still required.
                f.remediation = ILexDiff.Remediation.Required;
            }
            if (f.verification != ILexDiff.Verification.Fail) {
                f.openedAt = uint64(block.timestamp);
                emit ILexDiff.FindingFailed(agreementId, input.key, input.kind, evidenceHash);
            }
            f.lastFailedCheck = checkNo;
        } else if (input.result == ILexDiff.Verification.Pass && f.lastFailedCheck != 0) {
            // Only an explicit Pass of a property that failed before, with a fix in progress, verifies the fix.
            ILexDiff.Remediation r = f.remediation;
            if (
                r == ILexDiff.Remediation.Required || r == ILexDiff.Remediation.FixProposed
                    || r == ILexDiff.Remediation.Reopened
            ) {
                f.remediation = ILexDiff.Remediation.FixVerified;
                f.fixVerifiedInCheck = checkNo;
                f.fixVerifiedAt = uint64(block.timestamp);
                emit ILexDiff.FindingFixVerified(agreementId, input.key, checkNo, evidenceHash);
            }
        }

        f.kind = input.kind;
        f.verification = input.result;
        f.detailsHash = input.detailsHash;
        f.evidenceHash = evidenceHash;
        f.lastCheck = checkNo;
    }

    /// @notice The developer proposed a replacement: every fix still required is now awaiting verification.
    function markFixesProposed(Ledger storage l) external {
        for (uint256 i; i < l.keys.length; ++i) {
            ILexDiff.Finding storage f = l.findings[l.keys[i]];
            if (f.remediation == ILexDiff.Remediation.Required || f.remediation == ILexDiff.Remediation.Reopened) {
                f.remediation = ILexDiff.Remediation.FixProposed;
            }
        }
    }

    // ---------------------------------------------------------------------
    // Signed decisions
    // ---------------------------------------------------------------------

    /// @dev `digest` is the EIP-712 digest computed by the registry with the signer's current nonce.
    ///      Decisions change Remediation or Disposition, never Verification.
    function applyDecision(
        ILexDiff.Agreement storage a,
        Ledger storage l,
        uint256 agreementId,
        bytes32 key,
        ILexDiff.DecisionType decision,
        bytes32 evidenceHash,
        bytes32 noteHash,
        address signer,
        bytes calldata signature,
        bytes32 digest
    ) external {
        ILexDiff.Finding storage f = l.findings[key];
        if (f.firstCheck == 0) revert ILexDiff.UnknownFinding(key);
        if (f.evidenceHash != evidenceHash) revert ILexDiff.StaleEvidence(evidenceHash, f.evidenceHash);
        if (!SignatureChecker.isValidSignatureNow(signer, digest, signature)) revert ILexDiff.InvalidSignature(signer);

        bool party = signer == a.client || signer == a.reviewer || signer == a.developer || signer == a.freelancer;
        bool failing = f.verification == ILexDiff.Verification.Fail
            || f.verification == ILexDiff.Verification.Inconclusive;

        if (decision == ILexDiff.DecisionType.AcceptRisk) {
            if (signer != a.client) revert ILexDiff.WrongRole(signer, decision);
            if (!failing) revert ILexDiff.NotApplicable(f.verification, decision);
            f.disposition = ILexDiff.Disposition.Accepted;
        } else if (decision == ILexDiff.DecisionType.RequireRemediation) {
            if (signer != a.reviewer) revert ILexDiff.WrongRole(signer, decision);
            if (!failing) revert ILexDiff.NotApplicable(f.verification, decision);
            f.remediation = ILexDiff.Remediation.Required;
            f.assignee = a.developer;
            if (f.disposition == ILexDiff.Disposition.Undecided) f.disposition = ILexDiff.Disposition.Rejected;
        } else if (decision == ILexDiff.DecisionType.Acknowledge) {
            if (!party) revert ILexDiff.WrongRole(signer, decision);
        } else if (decision == ILexDiff.DecisionType.Dispute) {
            // Any finding may be disputed, including a Pass the party disagrees with.
            if (!party) revert ILexDiff.WrongRole(signer, decision);
            if (noteHash == bytes32(0)) revert ILexDiff.ReasonRequired();
            f.disposition = ILexDiff.Disposition.Disputed;
            f.disputedInCheck = f.lastCheck;
        } else {
            revert ILexDiff.NotApplicable(f.verification, decision);
        }

        l.decisions[key].push(
            ILexDiff.Decision({
                decision: decision,
                signer: signer,
                evidenceHash: evidenceHash,
                noteHash: noteHash,
                signature: signature,
                timestamp: uint64(block.timestamp),
                atCheck: f.lastCheck
            })
        );
        emit ILexDiff.DecisionRecorded(agreementId, key, decision, signer, f.remediation, f.disposition, noteHash);
    }
}
