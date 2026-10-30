// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import {Test} from "forge-std/Test.sol";
import {MockUSDC} from "../src/demo/MockUSDC.sol";
import {FreelanceEscrowV1} from "../src/demo/FreelanceEscrowV1.sol";
import {FreelanceEscrowV2} from "../src/demo/FreelanceEscrowV2.sol";
contract EscrowBehavioralVerificationTest is Test {
 MockUSDC token; FreelanceEscrowV2 v2; FreelanceEscrowV1 v1;
 address client=address(0x101);address freelancer=address(0x102);address stranger=address(0x103);
 uint256 amount=1000;
 function setUp() public {
  vm.warp(1_800_000_000);
  token=new MockUSDC();v1=new FreelanceEscrowV1(token,client,freelancer,amount);v2=new FreelanceEscrowV2(token,client,freelancer,amount);
  token.mint(client,amount*2);vm.startPrank(client);token.approve(address(v1),amount);token.approve(address(v2),amount);v1.fund();v2.fund();vm.stopPrank();
 }
 function testV2RefundOnlyAfterDeadlinePaysClientExactlyOnce() public {
  uint256 prior=token.balanceOf(client);
  vm.prank(client);vm.expectRevert(bytes("deadline not passed"));v2.refund();
  vm.warp(block.timestamp+30 days+1);
  vm.prank(stranger);vm.expectRevert(bytes("only client"));v2.refund();
  vm.prank(client);v2.refund();
  assertEq(token.balanceOf(client),prior+amount);assertEq(token.balanceOf(address(v2)),0);assertTrue(v2.released());
  vm.prank(client);vm.expectRevert(bytes("bad state"));v2.refund();
 }
 function testV1HasNoRefundSelector() public {
  vm.warp(block.timestamp+31 days);
  (bool ok,)=address(v1).call(abi.encodeWithSignature("refund()"));assertFalse(ok);
 }
 function testOwnerCanDrainV2DespiteRefundMethod() public {
  // This adverse result MUST remain a finding and prevents a global Pass.
  v2.emergencyWithdraw(stranger);
  assertEq(token.balanceOf(stranger),amount);
  vm.warp(block.timestamp+31 days);
  vm.prank(client);vm.expectRevert();v2.refund();
 }
}
