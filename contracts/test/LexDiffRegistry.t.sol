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

    ILexDiff.Kind constant MATCH = ILexDiff.Kind.Match;
    ILexDiff.Kind constant MISMATCH = ILexDiff.Kind.Mismatch;
    ILexDiff.Kind constant MISSING = ILexDiff.Kind.Missing;
    ILexDiff.Kind constant HIDDEN = ILexDiff.Kind.HiddenPower;

    uint256 id;

    function setUp() public {
        vm.warp(1_800_000_000);
        client = vm.addr(clientPk);
        reviewer = vm.addr(reviewerPk);
<<<<<<< HEAD
        developer = vm.addr(developerPk);
        registry = new LexDiffRegistry();
        id = _register(_registration(0));
=======
        registry = new LexDiffRegistry();
        id = _register();
>>>>>>> df31607 (Align LexDiff with evidence-first design)
    }

    // --- helpers ---------------------------------------------------------

<<<<<<< HEAD
    function _registration(uint256 supersedes) internal view returns (ILexDiff.Registration memory r) {
        r = ILexDiff.Registration({
            client: client,
            reviewer: reviewer,
            developer: developer,
            target: escrowV1,
            termsHash: TERMS,
            termsURI: "https://lexdiff.example/api/terms/0x01",
            verifier: ILexDiff.Verifier(forwarder, address(0), bytes32(0)),
            supersedes: supersedes,
            deadline: block.timestamp + 1 days
        });
    }

    function _signDigest(uint256 pk, bytes32 digest) internal pure returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, digest);
        return abi.encodePacked(r, s, v);
=======
    function _register() internal returns (uint256) {
        uint256 deadline = block.timestamp + 1 days;
        bytes32 clientDigest = registry.agreementApprovalDigest(
            client, reviewer, developer, escrowV1, forwarder, TERMS, "ipfs://terms", "Freelance escrow", 0, deadline
        );
        bytes32 reviewerDigest = registry.agreementApprovalDigest(
            client, reviewer, developer, escrowV1, forwarder, TERMS, "ipfs://terms", "Freelance escrow", 0, deadline
        );
        (uint8 cv, bytes32 cr, bytes32 cs) = vm.sign(clientPk, clientDigest);
        (uint8 rv, bytes32 rr, bytes32 rs) = vm.sign(reviewerPk, reviewerDigest);
        return registry.registerAgreement(
            client,
            reviewer,
            developer,
            escrowV1,
            forwarder,
            TERMS,
            "ipfs://terms",
            "Freelance escrow",
            deadline,
            abi.encodePacked(cr, cs, cv),
            abi.encodePacked(rr, rs, rv)
        );
    }

    function _v1Findings() internal pure returns (LexDiffRegistry.FindingInput[] memory f) {
        f = new LexDiffRegistry.FindingInput[](4);
        f[0] = _finding(AMOUNT, LexDiffRegistry.Kind.Match);
        f[1] = _finding(DEADLINE, LexDiffRegistry.Kind.Mismatch);
        f[2] = _finding(REFUND, LexDiffRegistry.Kind.Missing);
        f[3] = _finding(WITHDRAW, LexDiffRegistry.Kind.HiddenPower);
    }

    function _v2Findings() internal pure returns (LexDiffRegistry.FindingInput[] memory f) {
        f = new LexDiffRegistry.FindingInput[](4);
        f[0] = _finding(AMOUNT, LexDiffRegistry.Kind.Match);
        f[1] = _finding(DEADLINE, LexDiffRegistry.Kind.Match);
        f[2] = _finding(REFUND, LexDiffRegistry.Kind.Match);
        f[3] = _finding(WITHDRAW, LexDiffRegistry.Kind.HiddenPower);
    }

    function _finding(bytes32 key, LexDiffRegistry.Kind kind)
        internal
        pure
        returns (LexDiffRegistry.FindingInput memory)
    {
        return LexDiffRegistry.FindingInput(key, kind, keccak256(abi.encode(key, kind)));
>>>>>>> df31607 (Align LexDiff with evidence-first design)
    }

    function _register(ILexDiff.Registration memory r) internal returns (uint256) {
        bytes32 digest = registry.registrationDigest(r);
        return registry.registerAgreement(r, _signDigest(clientPk, digest), _signDigest(reviewerPk, digest));
    }

    function _d(string memory s) internal pure returns (bytes32) {
        return keccak256(bytes(s));
    }

    function _v1Findings() internal pure returns (ILexDiff.FindingInput[] memory f) {
        f = new ILexDiff.FindingInput[](4);
        f[0] = ILexDiff.FindingInput(AMOUNT, MATCH, _d("amount ok"));
        f[1] = ILexDiff.FindingInput(DEADLINE, MISMATCH, _d("30 vs 3 days"));
        f[2] = ILexDiff.FindingInput(REFUND, MISSING, _d("no refund"));
        f[3] = ILexDiff.FindingInput(WITHDRAW, HIDDEN, _d("owner withdraw"));
    }

    function _v2Findings() internal pure returns (ILexDiff.FindingInput[] memory f) {
        f = _v1Findings();
        f[1] = ILexDiff.FindingInput(DEADLINE, MATCH, _d("30 days"));
        f[2] = ILexDiff.FindingInput(REFUND, MATCH, _d("refund()"));
    }

    function _report(address target, bytes32 codeHash, ILexDiff.FindingInput[] memory f) internal {
        vm.prank(forwarder);
<<<<<<< HEAD
        registry.onReport("", abi.encode(id, target, codeHash, TERMS, keccak256(abi.encode(codeHash)), f));
=======
        registry.onReport("", abi.encode(id, target, codeHash, TERMS, keccak256(abi.encode(codeHash, f)), f));
>>>>>>> df31607 (Align LexDiff with evidence-first design)
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

<<<<<<< HEAD
    function _decide(uint256 pk, bytes32 key, ILexDiff.DecisionType d, string memory note) internal {
        bytes32 noteHash = bytes(note).length == 0 ? bytes32(0) : _d(note);
        (bytes32 evidence, bytes memory sig) = _sign(pk, key, d, noteHash);
        registry.submitDecision(id, key, d, evidence, noteHash, block.timestamp + 1 days, vm.addr(pk), sig);
    }

    function _status(bytes32 key) internal view returns (uint8) {
        return uint8(registry.getFinding(id, key).status);
=======
    function _decide(uint256 pk, bytes32 key, LexDiffRegistry.DecisionType d, string memory note) internal {
        (bytes32 evidence, bytes memory sig) = _sign(pk, key, d, note);
        registry.submitDecision(id, key, d, evidence, keccak256(bytes(note)), block.timestamp + 1 days, vm.addr(pk), sig);
    }

    // --- tests -----------------------------------------------------------

    function test_onlyForwarderCanReport() public {
        vm.expectRevert(abi.encodeWithSelector(LexDiffRegistry.NotForwarder.selector, address(this)));
        registry.onReport("", abi.encode(id, escrowV1, bytes32(0), TERMS, bytes32(0), _v1Findings()));
>>>>>>> df31607 (Align LexDiff with evidence-first design)
    }

    function _moveToV2() internal {
        vm.prank(developer);
        registry.proposeContract(id, escrowV2);
        vm.prank(client);
        registry.acceptContract(id, escrowV2);
    }

    // --- 1. What was agreed? ---------------------------------------------

    function test_registrationRequiresClientAndReviewerSignatures() public {
        ILexDiff.Registration memory r = _registration(0);
        r.termsHash = keccak256("other terms");
        bytes32 digest = registry.registrationDigest(r);
        bytes memory clientSig = _signDigest(clientPk, digest);

        // Reviewer never approved these terms: the developer signed in their place.
        vm.expectRevert(abi.encodeWithSelector(ILexDiff.InvalidSignature.selector, reviewer));
        registry.registerAgreement(r, clientSig, _signDigest(developerPk, digest));

        // A signature over different terms does not count.
        bytes memory oldSig = _signDigest(reviewerPk, registry.registrationDigest(_registration(0)));
        vm.expectRevert(abi.encodeWithSelector(ILexDiff.InvalidSignature.selector, reviewer));
        registry.registerAgreement(r, clientSig, oldSig);
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
        assertEq(registry.getAgreement(amended).supersedes, id);

        // Cannot amend twice, and a different client cannot amend at all.
        r.termsHash = keccak256("amended again");
        bytes32 digest = registry.registrationDigest(r);
        bytes memory c = _signDigest(clientPk, digest);
        bytes memory rv = _signDigest(reviewerPk, digest);
        vm.expectRevert(abi.encodeWithSelector(ILexDiff.CannotSupersede.selector, id));
        registry.registerAgreement(r, c, rv);
    }

    // --- 2. Does the code match? -----------------------------------------

    function test_onlyTheAgreedForwarderCanReport() public {
        bytes memory report = abi.encode(id, escrowV1, bytes32(0), TERMS, bytes32(0), _v1Findings());
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
        bytes memory report = abi.encode(pinned, escrowV1, bytes32(0), r.termsHash, bytes32(0), _v1Findings());

        bytes memory wrong = abi.encodePacked(workflowId, bytes10("lexdiff"), makeAddr("attacker"), bytes2(0));
        vm.prank(forwarder);
        vm.expectRevert(ILexDiff.WrongWorkflow.selector);
        registry.onReport(wrong, report);

        vm.prank(forwarder);
        vm.expectRevert(ILexDiff.WrongWorkflow.selector);
        registry.onReport("", report);

        bytes memory right = abi.encodePacked(workflowId, bytes10("lexdiff"), owner, bytes2(0));
        vm.prank(forwarder);
        registry.onReport(right, report);
        ILexDiff.Check memory c = registry.getChecks(pinned)[0];
        assertEq(c.workflowOwner, owner);
        assertEq(c.workflowId, workflowId);
    }

    function test_reportRecordsHashesOnly() public {
        _report(escrowV1, keccak256("v1"), _v1Findings());

        assertEq(_status(AMOUNT), uint8(ILexDiff.Status.None));
        assertEq(_status(DEADLINE), uint8(ILexDiff.Status.Open));
        assertEq(_status(REFUND), uint8(ILexDiff.Status.Open));
        assertEq(_status(WITHDRAW), uint8(ILexDiff.Status.Open));
        assertEq(registry.getFinding(id, DEADLINE).detailsHash, _d("30 vs 3 days"));
        assertEq(registry.getChecks(id)[0].nonMatchCount, 3);
        assertEq(registry.getChecks(id)[0].reportHash, keccak256(abi.encode(keccak256("v1"))));
    }

    function test_rejectsStaleTargetAndWrongTerms() public {
        vm.prank(forwarder);
<<<<<<< HEAD
        vm.expectRevert(abi.encodeWithSelector(ILexDiff.StaleTarget.selector, escrowV2, escrowV1));
        registry.onReport("", abi.encode(id, escrowV2, bytes32(0), TERMS, bytes32(0), _v1Findings()));

        vm.prank(forwarder);
        vm.expectRevert(abi.encodeWithSelector(ILexDiff.TermsMismatch.selector, bytes32(0), TERMS));
=======
        vm.expectRevert(abi.encodeWithSelector(LexDiffRegistry.StaleTarget.selector, escrowV2, escrowV1));
        registry.onReport("", abi.encode(id, escrowV2, bytes32(0), TERMS, bytes32(0), _v1Findings()));

        vm.prank(forwarder);
        vm.expectRevert(abi.encodeWithSelector(LexDiffRegistry.TermsMismatch.selector, bytes32(0), TERMS));
>>>>>>> df31607 (Align LexDiff with evidence-first design)
        registry.onReport("", abi.encode(id, escrowV1, bytes32(0), bytes32(0), bytes32(0), _v1Findings()));
    }

    // --- 3–5. Full demo ----------------------------------------------------

    function test_fullDemoFlow() public {
        _report(escrowV1, keccak256("v1"), _v1Findings());

        _decide(reviewerPk, DEADLINE, ILexDiff.DecisionType.RequireRemediation, "Must be 30 days per s.3");
        _decide(reviewerPk, REFUND, ILexDiff.DecisionType.RequireRemediation, "Refund required per s.5");
        _decide(developerPk, DEADLINE, ILexDiff.DecisionType.Acknowledge, "");
        _decide(clientPk, WITHDRAW, ILexDiff.DecisionType.AcceptRisk, "Platform operator is trusted");

        ILexDiff.Finding memory f = registry.getFinding(id, DEADLINE);
        assertEq(uint8(f.status), uint8(ILexDiff.Status.RemediationRequired));
        assertEq(f.assignee, developer);
        assertEq(registry.getDecisions(id, DEADLINE)[1].signer, developer);
        assertEq(registry.getDecisions(id, WITHDRAW)[0].signer, client);

<<<<<<< HEAD
        _moveToV2();
=======
        // Developer proposes; the client accepts; only then does CRE re-run.
        vm.prank(developer);
        registry.proposeContract(id, escrowV2);
        vm.prank(client);
        registry.acceptContract(id);
>>>>>>> df31607 (Align LexDiff with evidence-first design)
        _report(escrowV2, keccak256("v2"), _v2Findings());

        assertEq(_status(DEADLINE), uint8(ILexDiff.Status.Resolved));
        assertEq(registry.getFinding(id, DEADLINE).resolvedInCheck, 2);
        assertEq(_status(REFUND), uint8(ILexDiff.Status.Resolved));
        assertEq(_status(WITHDRAW), uint8(ILexDiff.Status.AcceptedRisk));
        assertEq(registry.getContractHistory(id).length, 2);
    }

    function test_contractChangeNeedsDeveloperProposalAndClientAcceptance() public {
        vm.expectRevert(abi.encodeWithSelector(ILexDiff.NotAParty.selector, address(this)));
        registry.proposeContract(id, escrowV2);

        vm.prank(developer);
        registry.proposeContract(id, escrowV2);

        vm.prank(developer);
        vm.expectRevert(abi.encodeWithSelector(ILexDiff.NotClient.selector, developer));
        registry.acceptContract(id, escrowV2);

        // Client must accept exactly what was proposed.
        vm.prank(client);
        vm.expectRevert(abi.encodeWithSelector(ILexDiff.NoPendingContract.selector, makeAddr("other")));
        registry.acceptContract(id, makeAddr("other"));

        vm.prank(client);
        registry.acceptContract(id, escrowV2);
        assertEq(registry.getAgreement(id).target, escrowV2);
        assertEq(registry.getAgreement(id).pendingTarget, address(0));
    }

    function test_unresolvedFindingStaysOpenAfterRedeploy() public {
        _report(escrowV1, keccak256("v1"), _v1Findings());
<<<<<<< HEAD
        _decide(reviewerPk, DEADLINE, ILexDiff.DecisionType.RequireRemediation, "fix");
        _moveToV2();
=======
        _decide(reviewerPk, DEADLINE, LexDiffRegistry.DecisionType.RequireRemediation, "fix");
        vm.prank(developer);
        registry.proposeContract(id, escrowV2);
        vm.prank(client);
        registry.acceptContract(id);
        // Developer "fixed" it, but the code still says 3 days.
>>>>>>> df31607 (Align LexDiff with evidence-first design)
        _report(escrowV2, keccak256("v2-bad"), _v1Findings());
        assertEq(_status(DEADLINE), uint8(ILexDiff.Status.RemediationRequired));
    }

    function test_removedPowerIsResolvedBySnapshot() public {
        _report(escrowV1, keccak256("v1"), _v1Findings());
        ILexDiff.FindingInput[] memory v3 = new ILexDiff.FindingInput[](3);
        ILexDiff.FindingInput[] memory v2 = _v2Findings();
        for (uint256 i; i < 3; ++i) v3[i] = v2[i];
        _report(escrowV1, keccak256("v3"), v3);
<<<<<<< HEAD
        ILexDiff.Finding memory f = registry.getFinding(id, WITHDRAW);
        assertEq(uint8(f.status), uint8(ILexDiff.Status.Resolved));
        assertEq(f.detailsHash, bytes32(0));
=======
        LexDiffRegistry.Finding memory f = registry.getFinding(id, WITHDRAW);
        assertEq(uint8(f.status), uint8(LexDiffRegistry.Status.Resolved));
>>>>>>> df31607 (Align LexDiff with evidence-first design)
    }

    function test_regressionReopens() public {
        _report(escrowV1, keccak256("v1"), _v1Findings());
        _report(escrowV1, keccak256("v2"), _v2Findings());
        assertEq(_status(DEADLINE), uint8(ILexDiff.Status.Resolved));
        _report(escrowV1, keccak256("v1-again"), _v1Findings());
        assertEq(_status(DEADLINE), uint8(ILexDiff.Status.Open));
        ILexDiff.FindingInput[] memory f = _v1Findings();
        f[0].kind = MISMATCH;
        _report(escrowV1, keccak256("v4"), f);
        assertEq(_status(AMOUNT), uint8(ILexDiff.Status.Open));
    }

    // --- Decisions -----------------------------------------------------------

    function test_rolesAreEnforced() public {
        _report(escrowV1, keccak256("v1"), _v1Findings());

        (bytes32 ev, bytes memory sig) = _sign(reviewerPk, WITHDRAW, ILexDiff.DecisionType.AcceptRisk, 0);
        vm.expectRevert(
            abi.encodeWithSelector(ILexDiff.WrongRole.selector, reviewer, ILexDiff.DecisionType.AcceptRisk)
        );
        registry.submitDecision(
<<<<<<< HEAD
            id, WITHDRAW, ILexDiff.DecisionType.AcceptRisk, ev, 0, block.timestamp + 1 days, reviewer, sig
        );

        // An outsider cannot even acknowledge.
        uint256 outsiderPk = 0x0B5;
        (ev, sig) = _sign(outsiderPk, WITHDRAW, ILexDiff.DecisionType.Acknowledge, 0);
=======
            id, WITHDRAW, LexDiffRegistry.DecisionType.AcceptRisk, ev, keccak256(""), block.timestamp + 1 days, reviewer, sig
        );

        // Signature from the client but claimed to be the reviewer's.
        (ev, sig) = _sign(clientPk, DEADLINE, LexDiffRegistry.DecisionType.RequireRemediation, "");
        vm.expectRevert(LexDiffRegistry.InvalidSignature.selector);
        registry.submitDecision(
            id, DEADLINE, LexDiffRegistry.DecisionType.RequireRemediation, ev, keccak256(""), block.timestamp + 1 days, reviewer, sig
        );
    }

    function test_nobodyCanResolveByDecision() public {
        _report(escrowV1, keccak256("v1"), _v1Findings());
        (bytes32 ev, bytes memory sig) = _sign(clientPk, AMOUNT, LexDiffRegistry.DecisionType.AcceptRisk, "");
        // A match has nothing to accept.
>>>>>>> df31607 (Align LexDiff with evidence-first design)
        vm.expectRevert(
            abi.encodeWithSelector(
                ILexDiff.WrongRole.selector, vm.addr(outsiderPk), ILexDiff.DecisionType.Acknowledge
            )
        );
        registry.submitDecision(
<<<<<<< HEAD
            id, WITHDRAW, ILexDiff.DecisionType.Acknowledge, ev, 0, block.timestamp + 1 days, vm.addr(outsiderPk), sig
        );

        // Signature from the client but claimed to be the reviewer's.
        (ev, sig) = _sign(clientPk, DEADLINE, ILexDiff.DecisionType.RequireRemediation, 0);
        vm.expectRevert(abi.encodeWithSelector(ILexDiff.InvalidSignature.selector, reviewer));
        registry.submitDecision(
            id, DEADLINE, ILexDiff.DecisionType.RequireRemediation, ev, 0, block.timestamp + 1 days, reviewer, sig
        );
    }

    function test_noDecisionCanResolve() public {
        _report(escrowV1, keccak256("v1"), _v1Findings());
        _decide(developerPk, DEADLINE, ILexDiff.DecisionType.Acknowledge, "");
        _decide(developerPk, DEADLINE, ILexDiff.DecisionType.Dispute, "3 days is what the client asked for by email");
        _decide(clientPk, DEADLINE, ILexDiff.DecisionType.AcceptRisk, "");
        assertEq(_status(DEADLINE), uint8(ILexDiff.Status.AcceptedRisk));
        // The technical classification is untouched by every human decision.
        assertEq(uint8(registry.getFinding(id, DEADLINE).kind), uint8(MISMATCH));

        (bytes32 ev, bytes memory sig) = _sign(clientPk, AMOUNT, ILexDiff.DecisionType.AcceptRisk, 0);
        vm.expectRevert(
            abi.encodeWithSelector(
                ILexDiff.InvalidTransition.selector,
                ILexDiff.Status.None,
                ILexDiff.DecisionType.AcceptRisk
            )
        );
        registry.submitDecision(
            id, AMOUNT, ILexDiff.DecisionType.AcceptRisk, ev, 0, block.timestamp + 1 days, client, sig
        );
    }

    function test_disputeIsRecordedWithoutRewritingHistory() public {
        _report(escrowV1, keccak256("v1"), _v1Findings());
        _report(escrowV1, keccak256("v2"), _v2Findings());
        // The reviewer contests a resolution; it stays resolved but is visibly disputed.
        _decide(reviewerPk, DEADLINE, ILexDiff.DecisionType.Dispute, "Getter says 30 days but a setter exists");
        ILexDiff.Finding memory f = registry.getFinding(id, DEADLINE);
        assertEq(uint8(f.status), uint8(ILexDiff.Status.Resolved));
        assertEq(f.disputedInCheck, 2);
        assertEq(registry.getDecisions(id, DEADLINE).length, 1);

        (bytes32 ev, bytes memory sig) = _sign(clientPk, DEADLINE, ILexDiff.DecisionType.Dispute, 0);
        vm.expectRevert(ILexDiff.ReasonRequired.selector);
        registry.submitDecision(
            id, DEADLINE, ILexDiff.DecisionType.Dispute, ev, 0, block.timestamp + 1 days, client, sig
=======
            id, AMOUNT, LexDiffRegistry.DecisionType.AcceptRisk, ev, keccak256(""), block.timestamp + 1 days, client, sig
>>>>>>> df31607 (Align LexDiff with evidence-first design)
        );
    }

    function test_signatureBoundToEvidence() public {
        _report(escrowV1, keccak256("v1"), _v1Findings());
        (bytes32 ev, bytes memory sig) = _sign(clientPk, WITHDRAW, ILexDiff.DecisionType.AcceptRisk, 0);
        _report(escrowV1, keccak256("v1b"), _v1Findings());
        bytes32 current = registry.getFinding(id, WITHDRAW).evidenceHash;
        vm.expectRevert(abi.encodeWithSelector(ILexDiff.StaleEvidence.selector, ev, current));
        registry.submitDecision(
<<<<<<< HEAD
            id, WITHDRAW, ILexDiff.DecisionType.AcceptRisk, ev, 0, block.timestamp + 1 days, client, sig
=======
            id, WITHDRAW, LexDiffRegistry.DecisionType.AcceptRisk, ev, keccak256("ok"), block.timestamp + 1 days, client, sig
>>>>>>> df31607 (Align LexDiff with evidence-first design)
        );
    }

    function test_signatureCannotBeReplayedOrUsedLate() public {
        _report(escrowV1, keccak256("v1"), _v1Findings());
<<<<<<< HEAD
        bytes32 ev = registry.getFinding(id, WITHDRAW).evidenceHash;
        ILexDiff.DecisionType accept = ILexDiff.DecisionType.AcceptRisk;

        // Expired: signed with a deadline that has already passed.
        uint256 past = block.timestamp - 1;
        bytes memory late = _signDigest(clientPk, registry.decisionDigest(id, WITHDRAW, accept, ev, 0, 0, past));
        vm.expectRevert(ILexDiff.SignatureExpired.selector);
        registry.submitDecision(id, WITHDRAW, accept, ev, 0, past, client, late);

        // Replayed: valid once, then the nonce has moved on.
        uint256 deadline = block.timestamp + 1 days;
        bytes memory sig = _signDigest(clientPk, registry.decisionDigest(id, WITHDRAW, accept, ev, 0, 0, deadline));
        registry.submitDecision(id, WITHDRAW, accept, ev, 0, deadline, client, sig);
        _decide(reviewerPk, WITHDRAW, ILexDiff.DecisionType.RequireRemediation, "override");
        vm.expectRevert(abi.encodeWithSelector(ILexDiff.InvalidSignature.selector, client));
        registry.submitDecision(id, WITHDRAW, accept, ev, 0, deadline, client, sig);
=======
        (bytes32 ev, bytes memory sig) = _sign(clientPk, WITHDRAW, LexDiffRegistry.DecisionType.AcceptRisk, "ok");
        registry.submitDecision(
            id, WITHDRAW, LexDiffRegistry.DecisionType.AcceptRisk, ev, keccak256("ok"), block.timestamp + 1 days, client, sig
        );
        _decide(reviewerPk, WITHDRAW, LexDiffRegistry.DecisionType.RequireRemediation, "override");
        vm.expectRevert(LexDiffRegistry.InvalidSignature.selector);
        registry.submitDecision(
            id, WITHDRAW, LexDiffRegistry.DecisionType.AcceptRisk, ev, keccak256("ok"), block.timestamp + 1 days, client, sig
        );
    }

    function test_contractReplacementRequiresDeveloperThenClient() public {
        vm.expectRevert(abi.encodeWithSelector(LexDiffRegistry.NotDeveloper.selector, address(this)));
        registry.proposeContract(id, escrowV2);

        vm.prank(developer);
        registry.proposeContract(id, escrowV2);
        vm.prank(reviewer);
        vm.expectRevert(abi.encodeWithSelector(LexDiffRegistry.NotClient.selector, reviewer));
        registry.acceptContract(id);

        vm.prank(client);
        registry.acceptContract(id);
        assertEq(registry.getAgreement(id).target, escrowV2);
    }

    function test_acknowledgeAndDisputePreserveStatus() public {
        _report(escrowV1, keccak256("v1"), _v1Findings());
        _decide(clientPk, DEADLINE, LexDiffRegistry.DecisionType.Acknowledge, "seen");
        assertEq(uint8(registry.getFinding(id, DEADLINE).status), uint8(LexDiffRegistry.Status.Open));
        _decide(reviewerPk, DEADLINE, LexDiffRegistry.DecisionType.Dispute, "comparison is contested");
        assertEq(uint8(registry.getFinding(id, DEADLINE).status), uint8(LexDiffRegistry.Status.Open));
        assertEq(registry.getDecisions(id, DEADLINE).length, 2);
>>>>>>> df31607 (Align LexDiff with evidence-first design)
    }
}
