// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import {Test} from "forge-std/Test.sol";
import {ConsentRegistrationGate} from "../src/security/ConsentRegistrationGate.sol";
contract ConsentRegistrationGateTest is Test {
    ConsentRegistrationGate gate;
    function setUp() public { gate = new ConsentRegistrationGate(); }
    function fixture() internal view returns (ConsentRegistrationGate.Consent memory c) {
        c = ConsentRegistrationGate.Consent(vm.addr(11), vm.addr(12), vm.addr(13), vm.addr(14), vm.addr(15), keccak256("terms"), keccak256("agreement"), keccak256("authority"), 1, block.timestamp + 1 hours);
    }
    function sign(uint256 key, bytes32 h) internal pure returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key,h); return abi.encodePacked(r,s,v);
    }
    function testThreeIndependentSignaturesAndReplay() public {
        ConsentRegistrationGate.Consent memory c = fixture(); bytes32 h = gate.digest(c);
        bytes memory a=sign(11,h); bytes memory b=sign(12,h); bytes memory f=sign(13,h);
        vm.expectRevert(abi.encodeWithSelector(ConsentRegistrationGate.InvalidSigner.selector,c.freelancer));
        gate.record(c,a,b,sign(14,h));
        gate.record(c,a,b,f);
        assertTrue(gate.approved(h));
        vm.expectRevert(ConsentRegistrationGate.InvalidConsent.selector);
        gate.record(c,a,b,f);
    }
    function testNoSelfReviewOrExpiredConsent() public {
        ConsentRegistrationGate.Consent memory c = fixture(); c.reviewer=c.client;
        vm.expectRevert(ConsentRegistrationGate.InvalidConsent.selector);
        gate.record(c,"","","");
        c=fixture(); c.deadline=block.timestamp-1;
        vm.expectRevert(ConsentRegistrationGate.InvalidConsent.selector);
        gate.record(c,"","","");
    }
}
