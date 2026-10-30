// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {SignatureChecker} from "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @notice Proposal -> approvals -> asset-observation -> activation evidence.
/// An independent opt-in attestation ledger; NOT connected to legacy acceptContract().
contract MigrationActivationGate is EIP712 {
    bytes32 public constant TYPEHASH = keccak256("Migration(bytes32 consentDigest,address client,address reviewer,address freelancer,address oldTarget,address newTarget,address asset,uint256 amount,bytes32 migrationEvidenceHash,uint256 deadline)");
    struct Migration { bytes32 consentDigest; address client; address reviewer; address freelancer; address oldTarget; address newTarget; address asset; uint256 amount; bytes32 migrationEvidenceHash; uint256 deadline; }
    mapping(bytes32 => bool) public activated;
    event Activated(bytes32 indexed migrationDigest,address indexed oldTarget,address indexed newTarget,address asset,uint256 amount);
    error MigrationUnverified();
    constructor() EIP712("LexDiffMigrationGate","1") {}
    function digest(Migration calldata m) public view returns(bytes32) {
        return _hashTypedDataV4(keccak256(abi.encode(TYPEHASH,m.consentDigest,m.client,m.reviewer,m.freelancer,m.oldTarget,m.newTarget,m.asset,m.amount,m.migrationEvidenceHash,m.deadline)));
    }
    function activate(Migration calldata m,bytes calldata clientSig,bytes calldata reviewerSig,bytes calldata freelancerSig) external {
        if(m.consentDigest==bytes32(0)||m.migrationEvidenceHash==bytes32(0)||m.asset==address(0)||m.amount==0||m.oldTarget==address(0)||m.newTarget==address(0)||m.oldTarget==m.newTarget||block.timestamp>m.deadline||m.client==m.reviewer||m.client==m.freelancer||m.freelancer==m.reviewer) revert MigrationUnverified();
        bytes32 h=digest(m);
        if(activated[h]||!SignatureChecker.isValidSignatureNow(m.client,h,clientSig)||!SignatureChecker.isValidSignatureNow(m.reviewer,h,reviewerSig)||!SignatureChecker.isValidSignatureNow(m.freelancer,h,freelancerSig)) revert MigrationUnverified();
        // Observations are only for the declared ERC-20 asset, not unknown assets or historic liabilities.
        if(IERC20(m.asset).balanceOf(m.oldTarget)!=0 || IERC20(m.asset).balanceOf(m.newTarget)<m.amount) revert MigrationUnverified();
        activated[h]=true;
        emit Activated(h,m.oldTarget,m.newTarget,m.asset,m.amount);
    }
}
