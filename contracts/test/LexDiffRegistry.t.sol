// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {LexDiffRegistry} from "../src/LexDiffRegistry.sol";

contract LexDiffRegistryTest is Test {
    LexDiffRegistry registry;

    address forwarder = makeAddr("forwarder");
    uint256 clientPk = 0xC11E;
    uint256 reviewerPk = 0xBEEF;
    uint256 developerPk = 0xDE7;
    address client;
    address reviewer;
    address developer;
    address escrowV1 = makeAddr("escrowV1");
    address escrowV2 = makeAddr("escrowV2");

    bytes32 constant TERMS = keccak256("terms");
    bytes32 constant DEADLINE = keccak256("term:deliveryPeriod");
    bytes32 constant REFUND = keccak256("term:refundOnMissedDeadline");
    bytes32 constant AMOUNT = keccak256("term:amount");
    bytes32 constant WITHDRAW = keccak256("power:emergencyWithdraw");

    LexDiffRegistry.Kind constant MATCH = LexDiffRegistry.Kind.Match;
    LexDiffRegistry.Kind constant MISMATCH = LexDiffRegistry.Kind.Mismatch;
    LexDiffRegistry.Kind constant MISSING = LexDiffRegistry.Kind.Missing;
    LexDiffRegistry.Kind constant HIDDEN = LexDiffRegistry.Kind.HiddenPower;

    uint256 id;

    function setUp() public {
        vm.warp(1_800_000_000);
        client = vm.addr(clientPk);
        reviewer = vm.addr(reviewerPk);
        developer = vm.addr(developerPk);
        registry = new LexDiffRegistry();
        id = _register(_registration(0));
    }

    // --- helpers ---------------------------------------------------------

    function _registration(uint256 supersedes) internal view returns (LexDiffRegistry.Registration memory r) {
        r = LexDiffRegistry.Registration({
            client: client,
            reviewer: reviewer,
            developer: developer,
            target: escrowV1,
            termsHash: TERMS,
            termsURI: "https://lexdiff.example/api/terms/0x01",
            verifier: LexDiffRegistry.Verifier(forwarder, address(0), bytes32(0)),
            supersedes: supersedes,
            deadline: block.timestamp + 1 days
        });
    }

    function _signDigest(uint256 pk, bytes32 digest) internal pure returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, digest);
        return abi.encodePacked(r, s, v);
    }

    function _register(LexDiffRegistry.Registration memory r) internal returns (uint256) {
        bytes32 digest = registry.registrationDigest(r);
        return registry.registerAgreement(r, _signDigest(clientPk, digest), _signDigest(reviewerPk, digest));
    }

    function _d(string memory s) internal pure returns (bytes32) {
        return keccak256(bytes(s));
    }

    function _v1Findings() internal pure returns (LexDiffRegistry.FindingInput[] memory f) {
        f = new LexDiffRegistry.FindingInput[](4);
        f[0] = LexDiffRegistry.FindingInput(AMOUNT, MATCH, _d("amount ok"));
        f[1] = LexDiffRegistry.FindingInput(DEADLINE, MISMATCH, _d("30 vs 3 days"));
        f[2] = LexDiffRegistry.FindingInput(REFUND, MISSING, _d("no refund"));
        f[3] = LexDiffRegistry.FindingInput(WITHDRAW, HIDDEN, _d("owner withdraw"));
    }

    function _v2Findings() internal pure returns (LexDiffRegistry.FindingInput[] memory f) {
        f = _v1Findings();
        f[1] = LexDiffRegistry.FindingInput(DEADLINE, MATCH, _d("30 days"));
        f[2] = LexDiffRegistry.FindingInput(REFUND, MATCH, _d("refund()"));
    }

    function _report(address target, bytes32 codeHash, LexDiffRegistry.FindingInput[] memory f) internal {
        vm.prank(forwarder);
        registry.onReport("", abi.encode(id, target, codeHash, TERMS, keccak256(abi.encode(codeHash)), f));
    }

    function _sign(uint256 pk, bytes32 key, LexDiffRegistry.DecisionType d, bytes32 noteHash)
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

    function _decide(uint256 pk, bytes32 key, LexDiffRegistry.DecisionType d, string memory note) internal {
        bytes32 noteHash = bytes(note).length == 0 ? bytes32(0) : _d(note);
        (bytes32 evidence, bytes memory sig) = _sign(pk, key, d, noteHash);
        registry.submitDecision(id, key, d, evidence, noteHash, block.timestamp + 1 days, vm.addr(pk), sig);
    }

    function _status(bytes32 key) internal view returns (uint8) {
        return uint8(registry.getFinding(id, key).status);
    }

    function _moveToV2() internal {
        vm.prank(developer);
        registry.proposeContract(id, escrowV2);
        vm.prank(client);
        registry.acceptContract(id, escrowV2);
    }

    // --- 1. What was agreed? ---------------------------------------------

    function test_registrationRequiresClientAndReviewerSignatures() public {
        LexDiffRegistry.Registration memory r = _registration(0);
        r.termsHash = keccak256("other terms");
        bytes32 digest = registry.registrationDigest(r);
        bytes memory clientSig = _signDigest(clientPk, digest);

        // Reviewer never approved these terms: the developer signed in their place.
        vm.expectRevert(abi.encodeWithSelector(LexDiffRegistry.InvalidSignature.selector, reviewer));
        registry.registerAgreement(r, clientSig, _signDigest(developerPk, digest));

        // A signature over different terms does not count.
        bytes memory oldSig = _signDigest(reviewerPk, registry.registrationDigest(_registration(0)));
        vm.expectRevert(abi.encodeWithSelector(LexDiffRegistry.InvalidSignature.selector, reviewer));
        registry.registerAgreement(r, clientSig, oldSig);
    }

    function test_registrationCannotBeReplayed() public {
        LexDiffRegistry.Registration memory r = _registration(0);
        r.termsHash = keccak256("v2 terms");
        bytes32 digest = registry.registrationDigest(r);
        bytes memory c = _signDigest(clientPk, digest);
        bytes memory rv = _signDigest(reviewerPk, digest);
        registry.registerAgreement(r, c, rv);
        vm.expectRevert(LexDiffRegistry.RegistrationReplayed.selector);
        registry.registerAgreement(r, c, rv);
    }

    function test_amendmentSupersedesWithSameSigners() public {
        LexDiffRegistry.Registration memory r = _registration(id);
        r.termsHash = keccak256("amended terms");
        uint256 amended = _register(r);
        assertEq(registry.getAgreement(id).supersededBy, amended);
        assertEq(registry.getAgreement(amended).supersedes, id);

        // Cannot amend twice, and a different client cannot amend at all.
        r.termsHash = keccak256("amended again");
        bytes32 digest = registry.registrationDigest(r);
        bytes memory c = _signDigest(clientPk, digest);
        bytes memory rv = _signDigest(reviewerPk, digest);
        vm.expectRevert(abi.encodeWithSelector(LexDiffRegistry.CannotSupersede.selector, id));
        registry.registerAgreement(r, c, rv);
    }

    // --- 2. Does the code match? -----------------------------------------

    function test_onlyTheAgreedForwarderCanReport() public {
        bytes memory report = abi.encode(id, escrowV1, bytes32(0), TERMS, bytes32(0), _v1Findings());
        vm.expectRevert(abi.encodeWithSelector(LexDiffRegistry.NotForwarder.selector, address(this), forwarder));
        registry.onReport("", report);
    }

    function test_pinnedWorkflowIsEnforced() public {
        address owner = makeAddr("workflowOwner");
        bytes32 workflowId = keccak256("lexdiff-workflow");
        LexDiffRegistry.Registration memory r = _registration(0);
        r.termsHash = keccak256("pinned");
        r.verifier = LexDiffRegistry.Verifier(forwarder, owner, workflowId);
        uint256 pinned = _register(r);
        bytes memory report = abi.encode(pinned, escrowV1, bytes32(0), r.termsHash, bytes32(0), _v1Findings());

        bytes memory wrong = abi.encodePacked(workflowId, bytes10("lexdiff"), makeAddr("attacker"), bytes2(0));
        vm.prank(forwarder);
        vm.expectRevert(LexDiffRegistry.WrongWorkflow.selector);
        registry.onReport(wrong, report);

        vm.prank(forwarder);
        vm.expectRevert(LexDiffRegistry.WrongWorkflow.selector);
        registry.onReport("", report);

        bytes memory right = abi.encodePacked(workflowId, bytes10("lexdiff"), owner, bytes2(0));
        vm.prank(forwarder);
        registry.onReport(right, report);
        LexDiffRegistry.Check memory c = registry.getChecks(pinned)[0];
        assertEq(c.workflowOwner, owner);
        assertEq(c.workflowId, workflowId);
    }

    function test_reportRecordsHashesOnly() public {
        _report(escrowV1, keccak256("v1"), _v1Findings());

        assertEq(_status(AMOUNT), uint8(LexDiffRegistry.Status.None));
        assertEq(_status(DEADLINE), uint8(LexDiffRegistry.Status.Open));
        assertEq(_status(REFUND), uint8(LexDiffRegistry.Status.Open));
        assertEq(_status(WITHDRAW), uint8(LexDiffRegistry.Status.Open));
        assertEq(registry.getFinding(id, DEADLINE).detailsHash, _d("30 vs 3 days"));
        assertEq(registry.getChecks(id)[0].nonMatchCount, 3);
        assertEq(registry.getChecks(id)[0].reportHash, keccak256(abi.encode(keccak256("v1"))));
    }

    function test_rejectsStaleTargetAndWrongTerms() public {
        vm.prank(forwarder);
        vm.expectRevert(abi.encodeWithSelector(LexDiffRegistry.StaleTarget.selector, escrowV2, escrowV1));
        registry.onReport("", abi.encode(id, escrowV2, bytes32(0), TERMS, bytes32(0), _v1Findings()));

        vm.prank(forwarder);
        vm.expectRevert(abi.encodeWithSelector(LexDiffRegistry.TermsMismatch.selector, bytes32(0), TERMS));
        registry.onReport("", abi.encode(id, escrowV1, bytes32(0), bytes32(0), bytes32(0), _v1Findings()));
    }

    // --- 3–5. Full demo ----------------------------------------------------

    function test_fullDemoFlow() public {
        _report(escrowV1, keccak256("v1"), _v1Findings());

        _decide(reviewerPk, DEADLINE, LexDiffRegistry.DecisionType.RequireRemediation, "Must be 30 days per s.3");
        _decide(reviewerPk, REFUND, LexDiffRegistry.DecisionType.RequireRemediation, "Refund required per s.5");
        _decide(developerPk, DEADLINE, LexDiffRegistry.DecisionType.Acknowledge, "");
        _decide(clientPk, WITHDRAW, LexDiffRegistry.DecisionType.AcceptRisk, "Platform operator is trusted");

        LexDiffRegistry.Finding memory f = registry.getFinding(id, DEADLINE);
        assertEq(uint8(f.status), uint8(LexDiffRegistry.Status.RemediationRequired));
        assertEq(f.assignee, developer);
        assertEq(registry.getDecisions(id, DEADLINE)[1].signer, developer);
        assertEq(registry.getDecisions(id, WITHDRAW)[0].signer, client);

        _moveToV2();
        _report(escrowV2, keccak256("v2"), _v2Findings());

        assertEq(_status(DEADLINE), uint8(LexDiffRegistry.Status.Resolved));
        assertEq(registry.getFinding(id, DEADLINE).resolvedInCheck, 2);
        assertEq(_status(REFUND), uint8(LexDiffRegistry.Status.Resolved));
        assertEq(_status(WITHDRAW), uint8(LexDiffRegistry.Status.AcceptedRisk));
        assertEq(registry.getContractHistory(id).length, 2);
    }

    function test_contractChangeNeedsDeveloperProposalAndClientAcceptance() public {
        vm.expectRevert(abi.encodeWithSelector(LexDiffRegistry.NotAParty.selector, address(this)));
        registry.proposeContract(id, escrowV2);

        vm.prank(developer);
        registry.proposeContract(id, escrowV2);

        vm.prank(developer);
        vm.expectRevert(abi.encodeWithSelector(LexDiffRegistry.NotClient.selector, developer));
        registry.acceptContract(id, escrowV2);

        // Client must accept exactly what was proposed.
        vm.prank(client);
        vm.expectRevert(abi.encodeWithSelector(LexDiffRegistry.NoPendingContract.selector, makeAddr("other")));
        registry.acceptContract(id, makeAddr("other"));

        vm.prank(client);
        registry.acceptContract(id, escrowV2);
        assertEq(registry.getAgreement(id).target, escrowV2);
        assertEq(registry.getAgreement(id).pendingTarget, address(0));
    }

    function test_unresolvedFindingStaysOpenAfterRedeploy() public {
        _report(escrowV1, keccak256("v1"), _v1Findings());
        _decide(reviewerPk, DEADLINE, LexDiffRegistry.DecisionType.RequireRemediation, "fix");
        _moveToV2();
        _report(escrowV2, keccak256("v2-bad"), _v1Findings());
        assertEq(_status(DEADLINE), uint8(LexDiffRegistry.Status.RemediationRequired));
    }

    function test_removedPowerIsResolvedBySnapshot() public {
        _report(escrowV1, keccak256("v1"), _v1Findings());
        LexDiffRegistry.FindingInput[] memory v3 = new LexDiffRegistry.FindingInput[](3);
        LexDiffRegistry.FindingInput[] memory v2 = _v2Findings();
        for (uint256 i; i < 3; ++i) v3[i] = v2[i];
        _report(escrowV1, keccak256("v3"), v3);
        LexDiffRegistry.Finding memory f = registry.getFinding(id, WITHDRAW);
        assertEq(uint8(f.status), uint8(LexDiffRegistry.Status.Resolved));
        assertEq(f.detailsHash, bytes32(0));
    }

    function test_regressionReopens() public {
        _report(escrowV1, keccak256("v1"), _v1Findings());
        _report(escrowV1, keccak256("v2"), _v2Findings());
        assertEq(_status(DEADLINE), uint8(LexDiffRegistry.Status.Resolved));
        _report(escrowV1, keccak256("v1-again"), _v1Findings());
        assertEq(_status(DEADLINE), uint8(LexDiffRegistry.Status.Open));
        LexDiffRegistry.FindingInput[] memory f = _v1Findings();
        f[0].kind = MISMATCH;
        _report(escrowV1, keccak256("v4"), f);
        assertEq(_status(AMOUNT), uint8(LexDiffRegistry.Status.Open));
    }

    // --- Decisions -----------------------------------------------------------

    function test_rolesAreEnforced() public {
        _report(escrowV1, keccak256("v1"), _v1Findings());

        (bytes32 ev, bytes memory sig) = _sign(reviewerPk, WITHDRAW, LexDiffRegistry.DecisionType.AcceptRisk, 0);
        vm.expectRevert(
            abi.encodeWithSelector(LexDiffRegistry.WrongRole.selector, reviewer, LexDiffRegistry.DecisionType.AcceptRisk)
        );
        registry.submitDecision(
            id, WITHDRAW, LexDiffRegistry.DecisionType.AcceptRisk, ev, 0, block.timestamp + 1 days, reviewer, sig
        );

        // An outsider cannot even acknowledge.
        uint256 outsiderPk = 0x0B5;
        (ev, sig) = _sign(outsiderPk, WITHDRAW, LexDiffRegistry.DecisionType.Acknowledge, 0);
        vm.expectRevert(
            abi.encodeWithSelector(
                LexDiffRegistry.WrongRole.selector, vm.addr(outsiderPk), LexDiffRegistry.DecisionType.Acknowledge
            )
        );
        registry.submitDecision(
            id, WITHDRAW, LexDiffRegistry.DecisionType.Acknowledge, ev, 0, block.timestamp + 1 days, vm.addr(outsiderPk), sig
        );

        // Signature from the client but claimed to be the reviewer's.
        (ev, sig) = _sign(clientPk, DEADLINE, LexDiffRegistry.DecisionType.RequireRemediation, 0);
        vm.expectRevert(abi.encodeWithSelector(LexDiffRegistry.InvalidSignature.selector, reviewer));
        registry.submitDecision(
            id, DEADLINE, LexDiffRegistry.DecisionType.RequireRemediation, ev, 0, block.timestamp + 1 days, reviewer, sig
        );
    }

    function test_noDecisionCanResolve() public {
        _report(escrowV1, keccak256("v1"), _v1Findings());
        _decide(developerPk, DEADLINE, LexDiffRegistry.DecisionType.Acknowledge, "");
        _decide(developerPk, DEADLINE, LexDiffRegistry.DecisionType.Dispute, "3 days is what the client asked for by email");
        _decide(clientPk, DEADLINE, LexDiffRegistry.DecisionType.AcceptRisk, "");
        assertEq(_status(DEADLINE), uint8(LexDiffRegistry.Status.AcceptedRisk));
        // The technical classification is untouched by every human decision.
        assertEq(uint8(registry.getFinding(id, DEADLINE).kind), uint8(MISMATCH));

        (bytes32 ev, bytes memory sig) = _sign(clientPk, AMOUNT, LexDiffRegistry.DecisionType.AcceptRisk, 0);
        vm.expectRevert(
            abi.encodeWithSelector(
                LexDiffRegistry.InvalidTransition.selector,
                LexDiffRegistry.Status.None,
                LexDiffRegistry.DecisionType.AcceptRisk
            )
        );
        registry.submitDecision(
            id, AMOUNT, LexDiffRegistry.DecisionType.AcceptRisk, ev, 0, block.timestamp + 1 days, client, sig
        );
    }

    function test_disputeIsRecordedWithoutRewritingHistory() public {
        _report(escrowV1, keccak256("v1"), _v1Findings());
        _report(escrowV1, keccak256("v2"), _v2Findings());
        // The reviewer contests a resolution; it stays resolved but is visibly disputed.
        _decide(reviewerPk, DEADLINE, LexDiffRegistry.DecisionType.Dispute, "Getter says 30 days but a setter exists");
        LexDiffRegistry.Finding memory f = registry.getFinding(id, DEADLINE);
        assertEq(uint8(f.status), uint8(LexDiffRegistry.Status.Resolved));
        assertEq(f.disputedInCheck, 2);
        assertEq(registry.getDecisions(id, DEADLINE).length, 1);

        (bytes32 ev, bytes memory sig) = _sign(clientPk, DEADLINE, LexDiffRegistry.DecisionType.Dispute, 0);
        vm.expectRevert(LexDiffRegistry.ReasonRequired.selector);
        registry.submitDecision(
            id, DEADLINE, LexDiffRegistry.DecisionType.Dispute, ev, 0, block.timestamp + 1 days, client, sig
        );
    }

    function test_signatureBoundToEvidence() public {
        _report(escrowV1, keccak256("v1"), _v1Findings());
        (bytes32 ev, bytes memory sig) = _sign(clientPk, WITHDRAW, LexDiffRegistry.DecisionType.AcceptRisk, 0);
        _report(escrowV1, keccak256("v1b"), _v1Findings());
        bytes32 current = registry.getFinding(id, WITHDRAW).evidenceHash;
        vm.expectRevert(abi.encodeWithSelector(LexDiffRegistry.StaleEvidence.selector, ev, current));
        registry.submitDecision(
            id, WITHDRAW, LexDiffRegistry.DecisionType.AcceptRisk, ev, 0, block.timestamp + 1 days, client, sig
        );
    }

    function test_signatureCannotBeReplayedOrUsedLate() public {
        _report(escrowV1, keccak256("v1"), _v1Findings());
        bytes32 ev = registry.getFinding(id, WITHDRAW).evidenceHash;
        LexDiffRegistry.DecisionType accept = LexDiffRegistry.DecisionType.AcceptRisk;

        // Expired: signed with a deadline that has already passed.
        uint256 past = block.timestamp - 1;
        bytes memory late = _signDigest(clientPk, registry.decisionDigest(id, WITHDRAW, accept, ev, 0, 0, past));
        vm.expectRevert(LexDiffRegistry.SignatureExpired.selector);
        registry.submitDecision(id, WITHDRAW, accept, ev, 0, past, client, late);

        // Replayed: valid once, then the nonce has moved on.
        uint256 deadline = block.timestamp + 1 days;
        bytes memory sig = _signDigest(clientPk, registry.decisionDigest(id, WITHDRAW, accept, ev, 0, 0, deadline));
        registry.submitDecision(id, WITHDRAW, accept, ev, 0, deadline, client, sig);
        _decide(reviewerPk, WITHDRAW, LexDiffRegistry.DecisionType.RequireRemediation, "override");
        vm.expectRevert(abi.encodeWithSelector(LexDiffRegistry.InvalidSignature.selector, client));
        registry.submitDecision(id, WITHDRAW, accept, ev, 0, deadline, client, sig);
    }
}
