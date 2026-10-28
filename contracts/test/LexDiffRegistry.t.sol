// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {LexDiffRegistry} from "../src/LexDiffRegistry.sol";

contract LexDiffRegistryTest is Test {
    LexDiffRegistry registry;

    address forwarder = makeAddr("forwarder");
    uint256 clientPk = 0xC11E;
    uint256 reviewerPk = 0xBEEF;
    address client;
    address reviewer;
    address developer = makeAddr("developer");
    address escrowV1 = makeAddr("escrowV1");
    address escrowV2 = makeAddr("escrowV2");

    bytes32 constant TERMS = keccak256("terms");
    bytes32 constant DEADLINE = keccak256("term:deliveryPeriod");
    bytes32 constant REFUND = keccak256("term:refundOnMissedDeadline");
    bytes32 constant AMOUNT = keccak256("term:amount");
    bytes32 constant WITHDRAW = keccak256("power:emergencyWithdraw");

    uint256 id;

    function setUp() public {
        client = vm.addr(clientPk);
        reviewer = vm.addr(reviewerPk);
        registry = new LexDiffRegistry(forwarder);
        id = registry.registerAgreement(client, reviewer, developer, escrowV1, TERMS, "ipfs://terms", "Freelance escrow");
    }

    // --- helpers ---------------------------------------------------------

    function _v1Findings() internal pure returns (LexDiffRegistry.FindingInput[] memory f) {
        f = new LexDiffRegistry.FindingInput[](4);
        f[0] = LexDiffRegistry.FindingInput(AMOUNT, LexDiffRegistry.Kind.Match, "Amount", "1000 USDC", "1000 USDC");
        f[1] = LexDiffRegistry.FindingInput(DEADLINE, LexDiffRegistry.Kind.Mismatch, "Delivery deadline", "30 days", "3 days");
        f[2] = LexDiffRegistry.FindingInput(REFUND, LexDiffRegistry.Kind.Missing, "Refund", "refund if missed", "no refund function");
        f[3] = LexDiffRegistry.FindingInput(WITHDRAW, LexDiffRegistry.Kind.HiddenPower, "Admin power", "none", "owner can withdraw");
    }

    function _v2Findings() internal pure returns (LexDiffRegistry.FindingInput[] memory f) {
        f = new LexDiffRegistry.FindingInput[](4);
        f[0] = LexDiffRegistry.FindingInput(AMOUNT, LexDiffRegistry.Kind.Match, "Amount", "1000 USDC", "1000 USDC");
        f[1] = LexDiffRegistry.FindingInput(DEADLINE, LexDiffRegistry.Kind.Match, "Delivery deadline", "30 days", "30 days");
        f[2] = LexDiffRegistry.FindingInput(REFUND, LexDiffRegistry.Kind.Match, "Refund", "refund if missed", "refund()");
        f[3] = LexDiffRegistry.FindingInput(WITHDRAW, LexDiffRegistry.Kind.HiddenPower, "Admin power", "none", "owner can withdraw");
    }

    function _report(address target, bytes32 codeHash, LexDiffRegistry.FindingInput[] memory f) internal {
        vm.prank(forwarder);
        registry.onReport("", abi.encode(id, target, codeHash, TERMS, f));
    }

    function _sign(uint256 pk, bytes32 key, LexDiffRegistry.DecisionType d, string memory note)
        internal
        view
        returns (bytes32 evidence, bytes memory sig)
    {
        evidence = registry.getFinding(id, key).evidenceHash;
        address signer = vm.addr(pk);
        bytes32 digest = registry.decisionDigest(
            id, key, d, evidence, keccak256(bytes(note)), registry.nonces(signer), block.timestamp + 1 days
        );
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, digest);
        sig = abi.encodePacked(r, s, v);
    }

    function _decide(uint256 pk, bytes32 key, LexDiffRegistry.DecisionType d, string memory note) internal {
        (bytes32 evidence, bytes memory sig) = _sign(pk, key, d, note);
        registry.submitDecision(id, key, d, evidence, note, block.timestamp + 1 days, vm.addr(pk), sig);
    }

    // --- tests -----------------------------------------------------------

    function test_onlyForwarderCanReport() public {
        vm.expectRevert(abi.encodeWithSelector(LexDiffRegistry.NotForwarder.selector, address(this)));
        registry.onReport("", abi.encode(id, escrowV1, bytes32(0), TERMS, _v1Findings()));
    }

    function test_reportRecordsFindings() public {
        _report(escrowV1, keccak256("v1"), _v1Findings());

        assertEq(uint8(registry.getFinding(id, AMOUNT).status), uint8(LexDiffRegistry.Status.None));
        assertEq(uint8(registry.getFinding(id, DEADLINE).status), uint8(LexDiffRegistry.Status.Open));
        assertEq(uint8(registry.getFinding(id, REFUND).status), uint8(LexDiffRegistry.Status.Open));
        assertEq(uint8(registry.getFinding(id, WITHDRAW).status), uint8(LexDiffRegistry.Status.Open));
        assertEq(registry.getFindings(id).length, 4);
        assertEq(registry.getChecks(id).length, 1);
        assertEq(registry.getChecks(id)[0].nonMatchCount, 3);
    }

    function test_rejectsStaleTargetAndWrongTerms() public {
        vm.prank(forwarder);
        vm.expectRevert(abi.encodeWithSelector(LexDiffRegistry.StaleTarget.selector, escrowV2, escrowV1));
        registry.onReport("", abi.encode(id, escrowV2, bytes32(0), TERMS, _v1Findings()));

        vm.prank(forwarder);
        vm.expectRevert(abi.encodeWithSelector(LexDiffRegistry.TermsMismatch.selector, bytes32(0), TERMS));
        registry.onReport("", abi.encode(id, escrowV1, bytes32(0), bytes32(0), _v1Findings()));
    }

    function test_fullDemoFlow() public {
        _report(escrowV1, keccak256("v1"), _v1Findings());

        // Counsel assigns the deadline and refund findings to the developer.
        _decide(reviewerPk, DEADLINE, LexDiffRegistry.DecisionType.RequireRemediation, "Must be 30 days per s.3");
        _decide(reviewerPk, REFUND, LexDiffRegistry.DecisionType.RequireRemediation, "Refund required per s.5");
        // Client knowingly accepts the owner's withdrawal power.
        _decide(clientPk, WITHDRAW, LexDiffRegistry.DecisionType.AcceptRisk, "Platform operator is trusted");

        LexDiffRegistry.Finding memory f = registry.getFinding(id, DEADLINE);
        assertEq(uint8(f.status), uint8(LexDiffRegistry.Status.RemediationRequired));
        assertEq(f.assignee, developer);
        assertEq(registry.getDecisions(id, WITHDRAW)[0].signer, client);

        // Developer redeploys; CRE re-runs against the new contract.
        vm.prank(developer);
        registry.updateContract(id, escrowV2);
        _report(escrowV2, keccak256("v2"), _v2Findings());

        assertEq(uint8(registry.getFinding(id, DEADLINE).status), uint8(LexDiffRegistry.Status.Resolved));
        assertEq(registry.getFinding(id, DEADLINE).resolvedInCheck, 2);
        assertEq(uint8(registry.getFinding(id, REFUND).status), uint8(LexDiffRegistry.Status.Resolved));
        assertEq(uint8(registry.getFinding(id, WITHDRAW).status), uint8(LexDiffRegistry.Status.AcceptedRisk));
        assertEq(registry.getContractHistory(id).length, 2);
    }

    function test_unresolvedFindingStaysOpenAfterRedeploy() public {
        _report(escrowV1, keccak256("v1"), _v1Findings());
        _decide(reviewerPk, DEADLINE, LexDiffRegistry.DecisionType.RequireRemediation, "fix");
        vm.prank(developer);
        registry.updateContract(id, escrowV2);
        // Developer "fixed" it, but the code still says 3 days.
        _report(escrowV2, keccak256("v2-bad"), _v1Findings());
        assertEq(uint8(registry.getFinding(id, DEADLINE).status), uint8(LexDiffRegistry.Status.RemediationRequired));
    }

    function test_removedPowerIsResolvedBySnapshot() public {
        _report(escrowV1, keccak256("v1"), _v1Findings());
        LexDiffRegistry.FindingInput[] memory v3 = new LexDiffRegistry.FindingInput[](3);
        LexDiffRegistry.FindingInput[] memory v2 = _v2Findings();
        for (uint256 i; i < 3; ++i) v3[i] = v2[i];
        _report(escrowV1, keccak256("v3"), v3);
        LexDiffRegistry.Finding memory f = registry.getFinding(id, WITHDRAW);
        assertEq(uint8(f.status), uint8(LexDiffRegistry.Status.Resolved));
        assertEq(f.actual, "not present in code");
    }

    function test_regressionReopens() public {
        _report(escrowV1, keccak256("v1"), _v1Findings());
        _report(escrowV1, keccak256("v2"), _v2Findings());
        assertEq(uint8(registry.getFinding(id, DEADLINE).status), uint8(LexDiffRegistry.Status.Resolved));
        _report(escrowV1, keccak256("v1-again"), _v1Findings());
        assertEq(uint8(registry.getFinding(id, DEADLINE).status), uint8(LexDiffRegistry.Status.Open));
        // A match that turns into a mismatch is opened too.
        LexDiffRegistry.FindingInput[] memory f = _v1Findings();
        f[0].kind = LexDiffRegistry.Kind.Mismatch;
        _report(escrowV1, keccak256("v4"), f);
        assertEq(uint8(registry.getFinding(id, AMOUNT).status), uint8(LexDiffRegistry.Status.Open));
    }

    function test_rolesAreEnforced() public {
        _report(escrowV1, keccak256("v1"), _v1Findings());

        (bytes32 ev, bytes memory sig) = _sign(reviewerPk, WITHDRAW, LexDiffRegistry.DecisionType.AcceptRisk, "");
        vm.expectRevert(
            abi.encodeWithSelector(LexDiffRegistry.WrongRole.selector, reviewer, LexDiffRegistry.DecisionType.AcceptRisk)
        );
        registry.submitDecision(
            id, WITHDRAW, LexDiffRegistry.DecisionType.AcceptRisk, ev, "", block.timestamp + 1 days, reviewer, sig
        );

        // Signature from the client but claimed to be the reviewer's.
        (ev, sig) = _sign(clientPk, DEADLINE, LexDiffRegistry.DecisionType.RequireRemediation, "");
        vm.expectRevert(LexDiffRegistry.InvalidSignature.selector);
        registry.submitDecision(
            id, DEADLINE, LexDiffRegistry.DecisionType.RequireRemediation, ev, "", block.timestamp + 1 days, reviewer, sig
        );
    }

    function test_nobodyCanResolveByDecision() public {
        _report(escrowV1, keccak256("v1"), _v1Findings());
        (bytes32 ev, bytes memory sig) = _sign(clientPk, AMOUNT, LexDiffRegistry.DecisionType.AcceptRisk, "");
        // A match has nothing to accept.
        vm.expectRevert(
            abi.encodeWithSelector(
                LexDiffRegistry.InvalidTransition.selector,
                LexDiffRegistry.Status.None,
                LexDiffRegistry.DecisionType.AcceptRisk
            )
        );
        registry.submitDecision(
            id, AMOUNT, LexDiffRegistry.DecisionType.AcceptRisk, ev, "", block.timestamp + 1 days, client, sig
        );
    }

    function test_signatureBoundToEvidence() public {
        _report(escrowV1, keccak256("v1"), _v1Findings());
        (bytes32 ev, bytes memory sig) = _sign(clientPk, WITHDRAW, LexDiffRegistry.DecisionType.AcceptRisk, "ok");
        // A new check changes the evidence before the signature is submitted.
        _report(escrowV1, keccak256("v1b"), _v1Findings());
        bytes32 current = registry.getFinding(id, WITHDRAW).evidenceHash;
        vm.expectRevert(abi.encodeWithSelector(LexDiffRegistry.StaleEvidence.selector, ev, current));
        registry.submitDecision(
            id, WITHDRAW, LexDiffRegistry.DecisionType.AcceptRisk, ev, "ok", block.timestamp + 1 days, client, sig
        );
    }

    function test_signatureCannotBeReplayed() public {
        _report(escrowV1, keccak256("v1"), _v1Findings());
        (bytes32 ev, bytes memory sig) = _sign(clientPk, WITHDRAW, LexDiffRegistry.DecisionType.AcceptRisk, "ok");
        registry.submitDecision(
            id, WITHDRAW, LexDiffRegistry.DecisionType.AcceptRisk, ev, "ok", block.timestamp + 1 days, client, sig
        );
        _decide(reviewerPk, WITHDRAW, LexDiffRegistry.DecisionType.RequireRemediation, "override");
        vm.expectRevert(LexDiffRegistry.InvalidSignature.selector);
        registry.submitDecision(
            id, WITHDRAW, LexDiffRegistry.DecisionType.AcceptRisk, ev, "ok", block.timestamp + 1 days, client, sig
        );
    }

    function test_onlyPartiesCanUpdateContract() public {
        vm.expectRevert(abi.encodeWithSelector(LexDiffRegistry.NotAParty.selector, address(this)));
        registry.updateContract(id, escrowV2);
    }
}
