// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";

/// @notice Interface a Chainlink CRE consumer must implement to receive reports
///         delivered by the KeystoneForwarder (or MockKeystoneForwarder in simulation).
interface IReceiver is IERC165 {
    function onReport(bytes calldata metadata, bytes calldata report) external;
}
