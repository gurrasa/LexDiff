// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @title FreelanceEscrowV1 (DEMO — intentionally flawed)
/// @notice The "AI-generated" escrow from the LexDiff demo. It compiles and looks reasonable,
///         but diverges from the signed agreement:
///           - delivery deadline is 3 days instead of 30
///           - there is no refund when the deadline is missed
///           - the owner can withdraw all escrowed funds at any time
contract FreelanceEscrowV1 is Ownable {
    using SafeERC20 for IERC20;

    IERC20 public immutable token;
    address public immutable client;
    address public immutable freelancer;
    uint256 public immutable amount;

    uint256 public constant deliveryPeriod = 3 days;
    uint256 public constant reviewPeriod = 7 days;

    uint256 public fundedAt;
    uint256 public deliveredAt;
    bool public released;

    event Funded(uint256 amount);
    event Delivered(uint256 at);
    event Released(address to, uint256 amount);

    constructor(IERC20 token_, address client_, address freelancer_, uint256 amount_) Ownable(msg.sender) {
        token = token_;
        client = client_;
        freelancer = freelancer_;
        amount = amount_;
    }

    function fund() external {
        require(msg.sender == client, "only client");
        require(fundedAt == 0, "already funded");
        fundedAt = block.timestamp;
        token.safeTransferFrom(msg.sender, address(this), amount);
        emit Funded(amount);
    }

    function markDelivered() external {
        require(msg.sender == freelancer, "only freelancer");
        require(fundedAt != 0 && deliveredAt == 0, "bad state");
        require(block.timestamp <= fundedAt + deliveryPeriod, "deadline passed");
        deliveredAt = block.timestamp;
        emit Delivered(block.timestamp);
    }

    /// @notice Client accepts the delivery within the review period.
    function approve() external {
        require(msg.sender == client, "only client");
        require(deliveredAt != 0 && !released, "bad state");
        _release();
    }

    /// @notice Freelancer is paid automatically if the client stays silent during the review period.
    function claimAfterReview() external {
        require(msg.sender == freelancer, "only freelancer");
        require(deliveredAt != 0 && !released, "bad state");
        require(block.timestamp > deliveredAt + reviewPeriod, "review period running");
        _release();
    }

    function emergencyWithdraw(address to) external onlyOwner {
        token.safeTransfer(to, token.balanceOf(address(this)));
    }

    function _release() private {
        released = true;
        token.safeTransfer(freelancer, amount);
        emit Released(freelancer, amount);
    }
}
