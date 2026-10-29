// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {LexDiffRegistry} from "../src/LexDiffRegistry.sol";
import {ILexDiff} from "../src/ILexDiff.sol";

contract LexDiffRegistryTest is Test {
    LexDiffRegistry registry;

    address forwarder = makeAddr("forwarder");
    uint256 clientPk = 0xC11E;
    uint256 reviewerPk = 0xBEEF;
    uint256 developerPk = 0xDE7;
    uint256 freelancerPk = 0xF7EE;
    address client;
    address reviewer;
    address developer;
    address freelancer;
    address escrowV1 = makeAddr("escrowV1");
    address escrowV2 = makeAddr("escrowV2");

    bytes32 constant AGREEMENT = keccak256("full agreement text");
    bytes32 constant TERMS = keccak256("terms");
    bytes32 constant DEADLINE = keccak256("term:deliveryPeriod");
    bytes32 constant REFUND = keccak256("term:refundOnMissedDeadline");
    bytes32 constant AMOUNT = keccak256("term:amount");
    bytes32 constant WITHDRAW = keccak256("power:emergencyWithdraw");

    ILexDiff.Kind constant MATCH = ILexDiff.Kind.Match;
    ILexDiff.Kind constant MISMATCH = ILexDiff.Kind.Mismatch;
    ILexDiff.Kind constant MISSING = ILexDiff.Kind.Missing;
    ILexDiff.Kind constant HIDDEN = ILexDiff.Kind.HiddenPower;
    ILexDiff.Verification constant PASS = ILexDiff.Verification.Pass;
    ILexDiff.Verification constant FAIL = ILexDiff.Verification.Fail;

    uint256 id;

    function setUp() public {
        vm.warp(1_800_000_000);
        client = vm.addr(clientPk);
        reviewer = vm.addr(reviewerPk);
        developer = vm.addr(developerPk);
        freelancer = vm.addr(freelancerPk);
        registry = new LexDiffRegistry();
        id = _register(_registration(0));
    }

    // --- helpers ---------------------------------------------------------

    function _registration(uint256 supersedes) internal view returns (ILexDiff.Registration memory r) {
        r = ILexDiff.Registration({
            client: client,
            reviewer: reviewer,
            developer: developer,
            freelancer: freelancer,
            target: escrowV1,
            agreementHash: AGREEMENT,
            termsHash: TERMS,
            termsURI: "https://lexdiff.example/api/evidence/0x01",
            verifier: ILexDiff.Verifier(forwarder, address(0), bytes32(0)),
            supersedes: supersedes,
            deadline: block.timestamp + 1 days
        });
    }

    function _signDigest(uint256 pk, bytes32 digest) internal pure returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, digest);
        return abi.encodePacked(r, s, v);
    }

    function _register(ILexDiff.Registration memory r) internal returns (uint256) {
        bytes32 digest = registry.registrationDigest(r);
        return registry.registerAgreement(r, _signDigest(clientPk, digest), _signDigest(reviewerPk, digest));
    }

    function _d(string memory s) internal pure returns (bytes32) {
        return keccak256(bytes(s));
    }

    function _in(bytes32 key, ILexDiff.Kind kind, ILexDiff.Verification result, string memory details)
        internal
        pure
        returns (ILexDiff.FindingInput memory)
    {
        return ILexDiff.FindingInput(key, kind, result, _d(details));
    }

    function _v1() internal pure returns (ILexDiff.FindingInput[] memory f) {
        f = new ILexDiff.FindingInput[](4);
        f[0] = _in(AMOUNT, MATCH, PASS, "amount ok");
        f[1] = _in(DEADLINE, MISMATCH, FAIL, "30 vs 3 days");
        f[2] = _in(REFUND, MISSING, FAIL, "no refund");
        f[3] = _in(WITHDRAW, HIDDEN, FAIL, "owner withdraw");
    }

    function _v2() internal pure returns (ILexDiff.FindingInput[] memory f) {
        f = _v1();
        f[1] = _in(DEADLINE, MATCH, PASS, "30 days");
        f[2] = _in(REFUND, MATCH, PASS, "refund()");
    }

    function _report(address target, bytes32 codeHash, ILexDiff.FindingInput[] memory f) internal {
        vm.prank(forwarder);
        registry.onReport("", abi.encode(id, target, codeHash, TERMS, keccak256(abi.encode(codeHash)), f));
    }

    function _sign(uint256 pk, bytes32 key, ILexDiff.DecisionType d, bytes32 noteHash)
        internal
        view
        returns (bytes32 evidence, bytes memory sig)
    {
        evidence = registry.getFinding(id, key).evidenceHash;
        address signer = vm.addr(pk);
        bytes32 digest =
            registry.decisionDigest(id, key, d, evidence, noteHash, registry.nonces(signer), block.timestamp + 1 days);
        sig = _signDigest(pk, digest);
    }

    function _decide(uint256 pk, bytes32 key, ILexDiff.DecisionType d, string memory note) internal {
        bytes32 noteHash = bytes(note).length == 0 ? bytes32(0) : _d(note);
        (bytes32 evidence, bytes memory sig) = _sign(pk, key, d, noteHash);
        registry.submitDecision(id, key, d, evidence, noteHash, block.timestamp + 1 days, vm.addr(pk), sig);
    }

    function _f(bytes32 key) internal view returns (ILexDiff.Finding memory) {
        return registry.getFinding(id, key);
    }

    function _moveToV2() internal {
        vm.prank(developer);
        registry.proposeContract(id, escrowV2);
        vm.prank(client);
        registry.acceptContract(id, escrowV2);
    }

    // --- 1. What was agreed? ---------------------------------------------

    function test_registrationBindsFullAgreementAndAllParties() public view {
        ILexDiff.Agreement memory a = registry.getAgreement(id);
        assertEq(a.agreementHash, AGREEMENT);
        assertEq(a.termsHash, TERMS);
        assertEq(a.freelancer, freelancer);
    }

    function test_registrationRequiresClientAndReviewerSignatures() public {
        ILexDiff.Registration memory r = _registration(0);
        r.termsHash = keccak256("other terms");
        bytes32 digest = registry.registrationDigest(r);
        bytes memory clientSig = _signDigest(clientPk, digest);

        vm.expectRevert(abi.encodeWithSelector(ILexDiff.InvalidSignature.selector, reviewer));
        registry.registerAgreement(r, clientSig, _signDigest(developerPk, digest));

        // Changing the full agreement document invalidates earlier signatures.
        ILexDiff.Registration memory r2 = _registration(0);
        r2.agreementHash = keccak256("a different document");
        bytes memory oldSig = _signDigest(reviewerPk, registry.registrationDigest(_registration(0)));
        bytes memory clientSig2 = _signDigest(clientPk, registry.registrationDigest(r2));
        vm.expectRevert(abi.encodeWithSelector(ILexDiff.InvalidSignature.selector, reviewer));
        registry.registerAgreement(r2, clientSig2, oldSig);
    }

    function test_registrationCannotBeReplayed() public {
        ILexDiff.Registration memory r = _registration(0);
        r.termsHash = keccak256("v2 terms");
        bytes32 digest = registry.registrationDigest(r);
        bytes memory c = _signDigest(clientPk, digest);
        bytes memory rv = _signDigest(reviewerPk, digest);
        registry.registerAgreement(r, c, rv);
        vm.expectRevert(ILexDiff.RegistrationReplayed.selector);
        registry.registerAgreement(r, c, rv);
    }

    function test_amendmentSupersedesWithSameSigners() public {
        ILexDiff.Registration memory r = _registration(id);
        r.termsHash = keccak256("amended terms");
        uint256 amended = _register(r);
        assertEq(registry.getAgreement(id).supersededBy, amended);

        r.termsHash = keccak256("amended again");
        bytes32 digest = registry.registrationDigest(r);
        bytes memory c = _signDigest(clientPk, digest);
        bytes memory rv = _signDigest(reviewerPk, digest);
        vm.expectRevert(abi.encodeWithSelector(ILexDiff.CannotSupersede.selector, id));
        registry.registerAgreement(r, c, rv);
    }

    // --- 2. Does the code match? -----------------------------------------

    function test_onlyTheAgreedForwarderCanReport() public {
        bytes memory report = abi.encode(id, escrowV1, bytes32(0), TERMS, bytes32(0), _v1());
        vm.expectRevert(abi.encodeWithSelector(ILexDiff.NotForwarder.selector, address(this), forwarder));
        registry.onReport("", report);
    }

    function test_pinnedWorkflowIsEnforced() public {
        address owner = makeAddr("workflowOwner");
        bytes32 workflowId = keccak256("lexdiff-workflow");
        ILexDiff.Registration memory r = _registration(0);
        r.termsHash = keccak256("pinned");
        r.verifier = ILexDiff.Verifier(forwarder, owner, workflowId);
        uint256 pinned = _register(r);
        bytes memory report = abi.encode(pinned, escrowV1, bytes32(0), r.termsHash, bytes32(0), _v1());

        vm.prank(forwarder);
        vm.expectRevert(ILexDiff.WrongWorkflow.selector);
        registry.onReport(abi.encodePacked(workflowId, bytes10("lexdiff"), makeAddr("attacker"), bytes2(0)), report);

        vm.prank(forwarder);
        registry.onReport(abi.encodePacked(workflowId, bytes10("lexdiff"), owner, bytes2(0)), report);
        assertEq(registry.getChecks(pinned)[0].workflowOwner, owner);
    }

    function test_reportRecordsResultsAndCounts() public {
        _report(escrowV1, keccak256("v1"), _v1());
        assertEq(uint8(_f(AMOUNT).verification), uint8(PASS));
        assertEq(uint8(_f(DEADLINE).verification), uint8(FAIL));
        assertEq(uint8(_f(DEADLINE).remediation), uint8(ILexDiff.Remediation.None));
        assertEq(uint8(_f(DEADLINE).disposition), uint8(ILexDiff.Disposition.Undecided));
        ILexDiff.Check memory c = registry.getChecks(id)[0];
        assertEq(c.passed, 1);
        assertEq(c.failed, 3);
        assertEq(c.inconclusive, 0);
    }

    function test_reportMustCarryExplicitResults() public {
        ILexDiff.FindingInput[] memory f = _v1();
        f[0].result = ILexDiff.Verification.NotChecked;
        vm.prank(forwarder);
        vm.expectRevert(abi.encodeWithSelector(ILexDiff.InvalidResult.selector, AMOUNT));
        registry.onReport("", abi.encode(id, escrowV1, bytes32(0), TERMS, bytes32(0), f));
    }

    function test_rejectsStaleTargetAndWrongTerms() public {
        vm.prank(forwarder);
        vm.expectRevert(abi.encodeWithSelector(ILexDiff.StaleTarget.selector, escrowV2, escrowV1));
        registry.onReport("", abi.encode(id, escrowV2, bytes32(0), TERMS, bytes32(0), _v1()));

        vm.prank(forwarder);
        vm.expectRevert(abi.encodeWithSelector(ILexDiff.TermsMismatch.selector, bytes32(0), TERMS));
        registry.onReport("", abi.encode(id, escrowV1, bytes32(0), bytes32(0), bytes32(0), _v1()));
    }

    // --- 3–5. The corrected demo flow ---------------------------------------

    function test_fullDemoFlowKeepsDimensionsSeparate() public {
        _report(escrowV1, keccak256("v1"), _v1());

        _decide(reviewerPk, DEADLINE, ILexDiff.DecisionType.RequireRemediation, "Must be 30 days per s.3");
        _decide(reviewerPk, REFUND, ILexDiff.DecisionType.RequireRemediation, "Refund required per s.5");
        _decide(developerPk, DEADLINE, ILexDiff.DecisionType.Acknowledge, "");
        _decide(clientPk, WITHDRAW, ILexDiff.DecisionType.AcceptRisk, "Platform operator is trusted");

        ILexDiff.Finding memory deadline = _f(DEADLINE);
        assertEq(uint8(deadline.remediation), uint8(ILexDiff.Remediation.Required));
        assertEq(uint8(deadline.disposition), uint8(ILexDiff.Disposition.Rejected));
        assertEq(deadline.assignee, developer);

        // Accepting a risk changes the disposition only; the property still fails.
        ILexDiff.Finding memory withdraw = _f(WITHDRAW);
        assertEq(uint8(withdraw.disposition), uint8(ILexDiff.Disposition.Accepted));
        assertEq(uint8(withdraw.verification), uint8(FAIL));

        vm.prank(developer);
        registry.proposeContract(id, escrowV2);
        assertEq(uint8(_f(DEADLINE).remediation), uint8(ILexDiff.Remediation.FixProposed));
        assertEq(uint8(_f(WITHDRAW).remediation), uint8(ILexDiff.Remediation.None));
        vm.prank(client);
        registry.acceptContract(id, escrowV2);

        _report(escrowV2, keccak256("v2"), _v2());

        assertEq(uint8(_f(DEADLINE).verification), uint8(PASS));
        assertEq(uint8(_f(DEADLINE).remediation), uint8(ILexDiff.Remediation.FixVerified));
        assertEq(_f(DEADLINE).fixVerifiedInCheck, 2);
        assertEq(uint8(_f(REFUND).remediation), uint8(ILexDiff.Remediation.FixVerified));
        // The accepted risk is still a failing property, not a fixed one.
        assertEq(uint8(_f(WITHDRAW).verification), uint8(FAIL));
        assertEq(uint8(_f(WITHDRAW).disposition), uint8(ILexDiff.Disposition.Accepted));
        assertEq(uint8(_f(WITHDRAW).remediation), uint8(ILexDiff.Remediation.None));
    }

    function test_omittedPropertyBecomesNotCheckedNeverFixed() public {
        _report(escrowV1, keccak256("v1"), _v1());
        _decide(reviewerPk, WITHDRAW, ILexDiff.DecisionType.RequireRemediation, "remove it");
        // The next report simply leaves the withdrawal property out.
        ILexDiff.FindingInput[] memory subset = new ILexDiff.FindingInput[](3);
        ILexDiff.FindingInput[] memory v1 = _v1();
        for (uint256 i; i < 3; ++i) subset[i] = v1[i];
        _report(escrowV1, keccak256("v1-subset"), subset);

        ILexDiff.Finding memory f = _f(WITHDRAW);
        assertEq(uint8(f.verification), uint8(ILexDiff.Verification.NotChecked));
        assertEq(uint8(f.remediation), uint8(ILexDiff.Remediation.Required));
        assertEq(f.fixVerifiedInCheck, 0);
    }

    function test_explicitPassOfRemovedPowerVerifiesTheFix() public {
        _report(escrowV1, keccak256("v1"), _v1());
        _decide(reviewerPk, WITHDRAW, ILexDiff.DecisionType.RequireRemediation, "remove it");
        ILexDiff.FindingInput[] memory f = _v1();
        f[3] = _in(WITHDRAW, MATCH, PASS, "no longer present in code");
        _report(escrowV1, keccak256("v3"), f);
        assertEq(uint8(_f(WITHDRAW).remediation), uint8(ILexDiff.Remediation.FixVerified));
    }

    function test_proposedFixThatStillFailsGoesBackToRequired() public {
        _report(escrowV1, keccak256("v1"), _v1());
        _decide(reviewerPk, DEADLINE, ILexDiff.DecisionType.RequireRemediation, "fix");
        _moveToV2();
        _report(escrowV2, keccak256("v2-bad"), _v1());
        assertEq(uint8(_f(DEADLINE).remediation), uint8(ILexDiff.Remediation.Required));
        assertEq(uint8(_f(DEADLINE).verification), uint8(FAIL));
    }

    function test_passWithoutRemediationIsNotCalledAFix() public {
        _report(escrowV1, keccak256("v1"), _v1());
        // Nobody assigned a fix, but the property passes later anyway.
        _report(escrowV1, keccak256("v2"), _v2());
        assertEq(uint8(_f(DEADLINE).verification), uint8(PASS));
        assertEq(uint8(_f(DEADLINE).remediation), uint8(ILexDiff.Remediation.None));
    }

    function test_regressionReopensAVerifiedFix() public {
        _report(escrowV1, keccak256("v1"), _v1());
        _decide(reviewerPk, DEADLINE, ILexDiff.DecisionType.RequireRemediation, "fix");
        _report(escrowV1, keccak256("v2"), _v2());
        assertEq(uint8(_f(DEADLINE).remediation), uint8(ILexDiff.Remediation.FixVerified));
        _report(escrowV1, keccak256("v1-again"), _v1());
        assertEq(uint8(_f(DEADLINE).remediation), uint8(ILexDiff.Remediation.Reopened));
        assertEq(uint8(_f(DEADLINE).verification), uint8(FAIL));
    }

    function test_contractChangeNeedsDeveloperProposalAndClientApproval() public {
        vm.expectRevert(abi.encodeWithSelector(ILexDiff.NotAParty.selector, address(this)));
        registry.proposeContract(id, escrowV2);

        vm.prank(developer);
        registry.proposeContract(id, escrowV2);

        vm.prank(developer);
        vm.expectRevert(abi.encodeWithSelector(ILexDiff.NotClient.selector, developer));
        registry.acceptContract(id, escrowV2);

        vm.prank(client);
        vm.expectRevert(abi.encodeWithSelector(ILexDiff.NoPendingContract.selector, makeAddr("other")));
        registry.acceptContract(id, makeAddr("other"));

        vm.prank(client);
        registry.acceptContract(id, escrowV2);
        assertEq(registry.getAgreement(id).target, escrowV2);
    }

    // --- Decisions -----------------------------------------------------------

    function test_rolesAreEnforced() public {
        _report(escrowV1, keccak256("v1"), _v1());

        (bytes32 ev, bytes memory sig) = _sign(reviewerPk, WITHDRAW, ILexDiff.DecisionType.AcceptRisk, 0);
        vm.expectRevert(abi.encodeWithSelector(ILexDiff.WrongRole.selector, reviewer, ILexDiff.DecisionType.AcceptRisk));
        registry.submitDecision(id, WITHDRAW, ILexDiff.DecisionType.AcceptRisk, ev, 0, block.timestamp + 1 days, reviewer, sig);

        // The freelancer cannot accept the client's risk either.
        (ev, sig) = _sign(freelancerPk, WITHDRAW, ILexDiff.DecisionType.AcceptRisk, 0);
        vm.expectRevert(abi.encodeWithSelector(ILexDiff.WrongRole.selector, freelancer, ILexDiff.DecisionType.AcceptRisk));
        registry.submitDecision(id, WITHDRAW, ILexDiff.DecisionType.AcceptRisk, ev, 0, block.timestamp + 1 days, freelancer, sig);

        uint256 outsiderPk = 0x0B5;
        (ev, sig) = _sign(outsiderPk, WITHDRAW, ILexDiff.DecisionType.Acknowledge, 0);
        vm.expectRevert(
            abi.encodeWithSelector(ILexDiff.WrongRole.selector, vm.addr(outsiderPk), ILexDiff.DecisionType.Acknowledge)
        );
        registry.submitDecision(
            id, WITHDRAW, ILexDiff.DecisionType.Acknowledge, ev, 0, block.timestamp + 1 days, vm.addr(outsiderPk), sig
        );
    }

    function test_freelancerCanAcknowledgeAndDispute() public {
        _report(escrowV1, keccak256("v1"), _v1());
        _decide(freelancerPk, WITHDRAW, ILexDiff.DecisionType.Acknowledge, "");
        _decide(freelancerPk, WITHDRAW, ILexDiff.DecisionType.Dispute, "Owner withdrawal endangers my payout");
        assertEq(uint8(_f(WITHDRAW).disposition), uint8(ILexDiff.Disposition.Disputed));
        assertEq(registry.getDecisions(id, WITHDRAW)[1].signer, freelancer);
    }

    function test_decisionsNeverChangeTheVerificationResult() public {
        _report(escrowV1, keccak256("v1"), _v1());
        _decide(developerPk, DEADLINE, ILexDiff.DecisionType.Acknowledge, "");
        _decide(developerPk, DEADLINE, ILexDiff.DecisionType.Dispute, "3 days is what the client asked for by email");
        _decide(clientPk, DEADLINE, ILexDiff.DecisionType.AcceptRisk, "");
        assertEq(uint8(_f(DEADLINE).verification), uint8(FAIL));
        assertEq(uint8(_f(DEADLINE).kind), uint8(MISMATCH));

        // A passing property has no risk to accept.
        (bytes32 ev, bytes memory sig) = _sign(clientPk, AMOUNT, ILexDiff.DecisionType.AcceptRisk, 0);
        vm.expectRevert(abi.encodeWithSelector(ILexDiff.NotApplicable.selector, PASS, ILexDiff.DecisionType.AcceptRisk));
        registry.submitDecision(id, AMOUNT, ILexDiff.DecisionType.AcceptRisk, ev, 0, block.timestamp + 1 days, client, sig);
    }

    function test_disputeRequiresAReason() public {
        _report(escrowV1, keccak256("v1"), _v1());
        (bytes32 ev, bytes memory sig) = _sign(clientPk, DEADLINE, ILexDiff.DecisionType.Dispute, 0);
        vm.expectRevert(ILexDiff.ReasonRequired.selector);
        registry.submitDecision(id, DEADLINE, ILexDiff.DecisionType.Dispute, ev, 0, block.timestamp + 1 days, client, sig);
    }

    function test_signatureBoundToEvidence() public {
        _report(escrowV1, keccak256("v1"), _v1());
        (bytes32 ev, bytes memory sig) = _sign(clientPk, WITHDRAW, ILexDiff.DecisionType.AcceptRisk, 0);
        _report(escrowV1, keccak256("v1b"), _v1());
        bytes32 current = registry.getFinding(id, WITHDRAW).evidenceHash;
        vm.expectRevert(abi.encodeWithSelector(ILexDiff.StaleEvidence.selector, ev, current));
        registry.submitDecision(id, WITHDRAW, ILexDiff.DecisionType.AcceptRisk, ev, 0, block.timestamp + 1 days, client, sig);
    }

    function test_signatureCannotBeReplayedOrUsedLate() public {
        _report(escrowV1, keccak256("v1"), _v1());
        bytes32 ev = registry.getFinding(id, WITHDRAW).evidenceHash;
        ILexDiff.DecisionType accept = ILexDiff.DecisionType.AcceptRisk;

        uint256 past = block.timestamp - 1;
        bytes memory late = _signDigest(clientPk, registry.decisionDigest(id, WITHDRAW, accept, ev, 0, 0, past));
        vm.expectRevert(ILexDiff.SignatureExpired.selector);
        registry.submitDecision(id, WITHDRAW, accept, ev, 0, past, client, late);

        uint256 deadline = block.timestamp + 1 days;
        bytes memory sig = _signDigest(clientPk, registry.decisionDigest(id, WITHDRAW, accept, ev, 0, 0, deadline));
        registry.submitDecision(id, WITHDRAW, accept, ev, 0, deadline, client, sig);
        vm.expectRevert(abi.encodeWithSelector(ILexDiff.InvalidSignature.selector, client));
        registry.submitDecision(id, WITHDRAW, accept, ev, 0, deadline, client, sig);
    }
}
