// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @title WebsiteEscrow (DEMO — second test case)
/// @notice Shows that LexDiff is not hard-coded to one agreement. Against agreements/website-redesign.md:
///           - review period is 2 days instead of 5                      (Mismatch)
///           - the owner can change the delivery deadline after funding  (Hidden power: not granted)
///           - the owner can pause the escrow                            (Match: granted by clause 6.1)
contract WebsiteEscrow is Ownable {
    using SafeERC20 for IERC20;

    IERC20 public immutable token;
    address public immutable client;
    address public immutable freelancer;
    uint256 public immutable amount;

    uint256 public deliveryPeriod = 14 days;
    uint256 public constant reviewPeriod = 2 days;

    uint256 public fundedAt;
    uint256 public deliveredAt;
    bool public released;
    bool public paused;

    constructor(IERC20 token_, address client_, address freelancer_, uint256 amount_) Ownable(msg.sender) {
        token = token_;
        client = client_;
        freelancer = freelancer_;
        amount = amount_;
    }

    modifier whenNotPaused() {
        require(!paused, "paused");
        _;
    }

    function fund() external whenNotPaused {
        require(msg.sender == client, "only client");
        require(fundedAt == 0, "already funded");
        fundedAt = block.timestamp;
        token.safeTransferFrom(msg.sender, address(this), amount);
    }

    function markDelivered() external whenNotPaused {
        require(msg.sender == freelancer, "only freelancer");
        require(fundedAt != 0 && deliveredAt == 0, "bad state");
        require(block.timestamp <= fundedAt + deliveryPeriod, "deadline passed");
        deliveredAt = block.timestamp;
    }

    function approve() external whenNotPaused {
        require(msg.sender == client, "only client");
        require(deliveredAt != 0 && !released, "bad state");
        _release();
    }

    function claimAfterReview() external whenNotPaused {
        require(msg.sender == freelancer, "only freelancer");
        require(deliveredAt != 0 && !released, "bad state");
        require(block.timestamp > deliveredAt + reviewPeriod, "review period running");
        _release();
    }

    function refund() external whenNotPaused {
        require(msg.sender == client, "only client");
        require(fundedAt != 0 && deliveredAt == 0 && !released, "bad state");
        require(block.timestamp > fundedAt + deliveryPeriod, "deadline not passed");
        released = true;
        token.safeTransfer(client, amount);
    }

    /// Granted by clause 6.1 of the agreement.
    function pause() external onlyOwner {
        paused = true;
    }

    function unpause() external onlyOwner {
        paused = false;
    }

    /// NOT granted by the agreement.
    function setDeliveryPeriod(uint256 newPeriod) external onlyOwner {
        deliveryPeriod = newPeriod;
    }

    function _release() private {
        released = true;
        token.safeTransfer(freelancer, amount);
    }
}
