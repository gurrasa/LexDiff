// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {SignatureChecker} from "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";

/// @notice Opt-in consent registry prototype. NOT a replacement for LexDiffRegistry,
/// and does not authenticate legal identity, authority or possession of escrow funds.
contract ConsentRegistrationGate is EIP712 {
    bytes32 public constant CONSENT_TYPEHASH = keccak256(
        "Consent(address client,address reviewer,address freelancer,address developer,address target,bytes32 termsHash,bytes32 agreementHash,bytes32 capacityEvidenceHash,uint256 nonce,uint256 deadline)"
    );
    struct Consent {
        address client;
        address reviewer;
        address freelancer;
        address developer;
        address target;
        bytes32 termsHash;
        bytes32 agreementHash;
        bytes32 capacityEvidenceHash;
        uint256 nonce;
        uint256 deadline;
    }
    mapping(bytes32 => bool) public consumed;
    mapping(bytes32 => bool) public approved;
    event ConsentRecorded(bytes32 indexed digest, address indexed client, address indexed freelancer, address reviewer, bytes32 capacityEvidenceHash);
    error InvalidConsent();
    error InvalidSigner(address signer);
    constructor() EIP712("LexDiffConsentGate", "1") {}

    function digest(Consent calldata c) public view returns (bytes32) {
        return _hashTypedDataV4(keccak256(abi.encode(
            CONSENT_TYPEHASH, c.client, c.reviewer, c.freelancer, c.developer, c.target,
            c.termsHash, c.agreementHash, c.capacityEvidenceHash, c.nonce, c.deadline
        )));
    }
    function record(Consent calldata c, bytes calldata clientSig, bytes calldata reviewerSig, bytes calldata freelancerSig) external returns (bytes32 h) {
        if (c.client == address(0) || c.reviewer == address(0) || c.freelancer == address(0) || c.developer == address(0)
            || c.target == address(0) || c.client == c.reviewer || c.client == c.freelancer
            || c.reviewer == c.freelancer || c.termsHash == bytes32(0) || c.agreementHash == bytes32(0)
            || c.capacityEvidenceHash == bytes32(0) || block.timestamp > c.deadline) revert InvalidConsent();
        h = digest(c);
        if (consumed[h]) revert InvalidConsent();
        if (!SignatureChecker.isValidSignatureNow(c.client, h, clientSig)) revert InvalidSigner(c.client);
        if (!SignatureChecker.isValidSignatureNow(c.reviewer, h, reviewerSig)) revert InvalidSigner(c.reviewer);
        if (!SignatureChecker.isValidSignatureNow(c.freelancer, h, freelancerSig)) revert InvalidSigner(c.freelancer);
        consumed[h] = true;
        approved[h] = true;
        emit ConsentRecorded(h, c.client, c.freelancer, c.reviewer, c.capacityEvidenceHash);
    }
}
