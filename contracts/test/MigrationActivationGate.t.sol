// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import {Test} from "forge-std/Test.sol";
import {MigrationActivationGate} from "../src/security/MigrationActivationGate.sol";
import {MockUSDC} from "../src/demo/MockUSDC.sol";
contract MigrationActivationGateTest is Test {
    MigrationActivationGate gate; MockUSDC token;
    address oldTarget=address(0x101); address newTarget=address(0x102);
    function setUp() public { gate=new MigrationActivationGate(); token=new MockUSDC(); }
    function input() internal view returns(MigrationActivationGate.Migration memory m) {
       m=MigrationActivationGate.Migration(keccak256("approved consent"),vm.addr(11),vm.addr(12),vm.addr(13),oldTarget,newTarget,address(token),100,keccak256("tx evidence"),block.timestamp+1 hours);
    }
    function sign(uint256 key,bytes32 h) internal pure returns(bytes memory) { (uint8 v,bytes32 r,bytes32 s)=vm.sign(key,h);return abi.encodePacked(r,s,v); }
    function testCannotActivateWhenFundsRemainOldOrMissingAtNew() public {
      MigrationActivationGate.Migration memory m=input(); bytes32 h=gate.digest(m);
      token.mint(oldTarget,100); token.mint(newTarget,100);
      vm.expectRevert(MigrationActivationGate.MigrationUnverified.selector);
      gate.activate(m,sign(11,h),sign(12,h),sign(13,h));
      vm.prank(oldTarget); token.transfer(newTarget,100);
      gate.activate(m,sign(11,h),sign(12,h),sign(13,h));
      assertTrue(gate.activated(h));
      vm.expectRevert(MigrationActivationGate.MigrationUnverified.selector);
      gate.activate(m,sign(11,h),sign(12,h),sign(13,h));
    }
}
