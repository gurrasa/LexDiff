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
        address[] history; // contracts that enforced the agreement, oldest first
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
    ///      Each report is a complete snapshot: a previously recorded finding that is absent from the report
    ///      no longer exists in the code (e.g. a removed admin function) and is treated as a match.
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
        uint16 nonMatch;

        for (uint256 i; i < inputs.length; ++i) {
            if (inputs[i].kind != ILexDiff.Kind.Match) ++nonMatch;
            l.lastSeen[inputs[i].key] = checkNo;
            _applyFinding(l, agreementId, checkNo, checkContext, inputs[i]);
        }

        // Snapshot semantics: anything not reported this time is gone from the code.
        for (uint256 i; i < l.keys.length; ++i) {
            bytes32 key = l.keys[i];
            if (l.lastSeen[key] == checkNo || l.findings[key].kind == ILexDiff.Kind.Match) continue;
            _applyFinding(l, agreementId, checkNo, checkContext, ILexDiff.FindingInput(key, ILexDiff.Kind.Match, 0));
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
                findingCount: uint16(inputs.length),
                nonMatchCount: nonMatch
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
        bytes32 evidenceHash = keccak256(abi.encode(checkContext, input.key, input.kind, input.detailsHash));
        ILexDiff.Finding storage f = l.findings[input.key];

        if (f.firstCheck == 0) {
            l.keys.push(input.key);
            f.key = input.key;
            f.firstCheck = checkNo;
            if (input.kind != ILexDiff.Kind.Match) {
                f.status = ILexDiff.Status.Open;
                f.openedAt = uint64(block.timestamp);
                emit ILexDiff.FindingOpened(agreementId, input.key, input.kind, evidenceHash);
            }
        } else if (input.kind == ILexDiff.Kind.Match) {
            if (
                f.status == ILexDiff.Status.Open || f.status == ILexDiff.Status.AcceptedRisk
                    || f.status == ILexDiff.Status.RemediationRequired
            ) {
                f.status = ILexDiff.Status.Resolved;
                f.resolvedInCheck = checkNo;
                f.resolvedAt = uint64(block.timestamp);
                emit ILexDiff.FindingResolved(agreementId, input.key, checkNo, evidenceHash);
            }
        } else if (f.status == ILexDiff.Status.None || f.status == ILexDiff.Status.Resolved) {
            // Regression: something that matched (or was fixed) is wrong again.
            f.status = ILexDiff.Status.Open;
            f.assignee = address(0);
            f.resolvedInCheck = 0;
            f.resolvedAt = 0;
            f.openedAt = uint64(block.timestamp);
            emit ILexDiff.FindingReopened(agreementId, input.key, checkNo, evidenceHash);
        }

        f.kind = input.kind;
        f.detailsHash = input.detailsHash;
        f.evidenceHash = evidenceHash;
        f.lastCheck = checkNo;
    }

    // ---------------------------------------------------------------------
    // Signed decisions
    // ---------------------------------------------------------------------

    /// @dev `digest` is the EIP-712 digest computed by the registry with the signer's current nonce.
    ///      No decision type can resolve a finding.
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

        bool party = signer == a.client || signer == a.reviewer || signer == a.developer;
        if (decision == ILexDiff.DecisionType.AcceptRisk) {
            if (signer != a.client) revert ILexDiff.WrongRole(signer, decision);
            if (f.status != ILexDiff.Status.Open && f.status != ILexDiff.Status.RemediationRequired) {
                revert ILexDiff.InvalidTransition(f.status, decision);
            }
            f.status = ILexDiff.Status.AcceptedRisk;
            f.assignee = address(0);
        } else if (decision == ILexDiff.DecisionType.RequireRemediation) {
            if (signer != a.reviewer) revert ILexDiff.WrongRole(signer, decision);
            if (f.status != ILexDiff.Status.Open && f.status != ILexDiff.Status.AcceptedRisk) {
                revert ILexDiff.InvalidTransition(f.status, decision);
            }
            f.status = ILexDiff.Status.RemediationRequired;
            f.assignee = a.developer;
        } else if (decision == ILexDiff.DecisionType.Acknowledge) {
            if (!party) revert ILexDiff.WrongRole(signer, decision);
            if (f.kind == ILexDiff.Kind.Match && f.status != ILexDiff.Status.Resolved) {
                revert ILexDiff.InvalidTransition(f.status, decision);
            }
        } else if (decision == ILexDiff.DecisionType.Dispute) {
            // Any finding may be disputed, including a match or a resolution the party disagrees with.
            if (!party) revert ILexDiff.WrongRole(signer, decision);
            if (noteHash == bytes32(0)) revert ILexDiff.ReasonRequired();
            f.disputedInCheck = f.lastCheck;
        } else {
            revert ILexDiff.InvalidTransition(f.status, decision);
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
        emit ILexDiff.DecisionRecorded(agreementId, key, decision, signer, f.status, noteHash);
    }
}
