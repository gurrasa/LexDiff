// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {LexDiffRegistry} from "../src/LexDiffRegistry.sol";
import {MockUSDC} from "../src/demo/MockUSDC.sol";
import {FreelanceEscrowV1} from "../src/demo/FreelanceEscrowV1.sol";
import {FreelanceEscrowV2} from "../src/demo/FreelanceEscrowV2.sol";

/// @notice Deploys the registry and the demo escrow pair to Sepolia.
///
///   forge script script/Deploy.s.sol --rpc-url sepolia --broadcast --verify
///
/// Env:
///   PRIVATE_KEY          deployer (becomes escrow owner)
///   CLIENT_ADDRESS       defaults to deployer
///   FREELANCER_ADDRESS   defaults to deployer
/// The registry has no admin and no global forwarder: each agreement names its own verifier when the
/// parties sign it (the web app defaults to the Sepolia MockKeystoneForwarder used by `cre workflow simulate`).
contract Deploy is Script {
    uint256 constant AMOUNT = 1_000 * 1e6; // 1,000 USDC

    function run() external {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(pk);
        address client = vm.envOr("CLIENT_ADDRESS", deployer);
        address freelancer = vm.envOr("FREELANCER_ADDRESS", deployer);

        vm.startBroadcast(pk);
        LexDiffRegistry registry = new LexDiffRegistry();
        MockUSDC usdc = new MockUSDC();
        FreelanceEscrowV1 v1 = new FreelanceEscrowV1(usdc, client, freelancer, AMOUNT);
        FreelanceEscrowV2 v2 = new FreelanceEscrowV2(usdc, client, freelancer, AMOUNT);
        vm.stopBroadcast();

        console.log("LexDiffRegistry   ", address(registry));
        console.log("MockUSDC          ", address(usdc));
        console.log("FreelanceEscrowV1 ", address(v1));
        console.log("FreelanceEscrowV2 ", address(v2));

        string memory obj = "deployment";
        vm.serializeUint(obj, "chainId", block.chainid);
        vm.serializeUint(obj, "deployBlock", block.number);
        vm.serializeAddress(obj, "registry", address(registry));
        vm.serializeAddress(obj, "usdc", address(usdc));
        vm.serializeAddress(obj, "escrowV1", address(v1));
        vm.serializeAddress(obj, "escrowV2", address(v2));
        vm.serializeAddress(obj, "client", client);
        string memory json = vm.serializeAddress(obj, "freelancer", freelancer);
        vm.writeJson(json, string.concat("deployments/", vm.toString(block.chainid), ".json"));
    }
}
