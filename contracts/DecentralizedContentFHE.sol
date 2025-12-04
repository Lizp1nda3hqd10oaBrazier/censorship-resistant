// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { FHE, euint32, ebool } from "@fhevm/solidity/lib/FHE.sol";
import { SepoliaConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

contract DecentralizedContentFHE is SepoliaConfig {
    struct EncryptedContent {
        uint256 id;
        euint32 encryptedData;
        euint32 encryptedMetadata;
        uint256 timestamp;
    }

    struct DecryptedContent {
        string data;
        string metadata;
        bool revealed;
    }

    uint256 public contentCount;
    mapping(uint256 => EncryptedContent) public encryptedContents;
    mapping(uint256 => DecryptedContent) public decryptedContents;
    mapping(string => euint32) private encryptedMetadataCount;
    string[] private metadataList;
    mapping(uint256 => uint256) private requestToContentId;

    event ContentUploaded(uint256 indexed id, uint256 timestamp);
    event DecryptionRequested(uint256 indexed id);
    event ContentDecrypted(uint256 indexed id);

    modifier onlyUploader(uint256 contentId) {
        _;
    }

    function uploadEncryptedContent(
        euint32 encryptedData,
        euint32 encryptedMetadata
    ) public {
        contentCount += 1;
        uint256 newId = contentCount;

        encryptedContents[newId] = EncryptedContent({
            id: newId,
            encryptedData: encryptedData,
            encryptedMetadata: encryptedMetadata,
            timestamp: block.timestamp
        });

        decryptedContents[newId] = DecryptedContent({
            data: "",
            metadata: "",
            revealed: false
        });

        emit ContentUploaded(newId, block.timestamp);
    }

    function requestContentDecryption(uint256 contentId) public onlyUploader(contentId) {
        EncryptedContent storage content = encryptedContents[contentId];
        require(!decryptedContents[contentId].revealed, "Already revealed");

        bytes32[] memory ciphertexts = new bytes32[](2);
        ciphertexts[0] = FHE.toBytes32(content.encryptedData);
        ciphertexts[1] = FHE.toBytes32(content.encryptedMetadata);

        uint256 reqId = FHE.requestDecryption(ciphertexts, this.decryptContent.selector);
        requestToContentId[reqId] = contentId;

        emit DecryptionRequested(contentId);
    }

    function decryptContent(
        uint256 requestId,
        bytes memory cleartexts,
        bytes memory proof
    ) public {
        uint256 contentId = requestToContentId[requestId];
        require(contentId != 0, "Invalid request");

        FHE.checkSignatures(requestId, cleartexts, proof);
        string[] memory results = abi.decode(cleartexts, (string[]));

        DecryptedContent storage dContent = decryptedContents[contentId];
        dContent.data = results[0];
        dContent.metadata = results[1];
        dContent.revealed = true;

        if (!FHE.isInitialized(encryptedMetadataCount[dContent.metadata])) {
            encryptedMetadataCount[dContent.metadata] = FHE.asEuint32(0);
            metadataList.push(dContent.metadata);
        }
        encryptedMetadataCount[dContent.metadata] = FHE.add(
            encryptedMetadataCount[dContent.metadata],
            FHE.asEuint32(1)
        );

        emit ContentDecrypted(contentId);
    }

    function getDecryptedContent(uint256 contentId) public view returns (
        string memory data,
        string memory metadata,
        bool revealed
    ) {
        DecryptedContent storage c = decryptedContents[contentId];
        return (c.data, c.metadata, c.revealed);
    }

    function getEncryptedMetadataCount(string memory metadata) public view returns (euint32) {
        return encryptedMetadataCount[metadata];
    }

    function requestMetadataCountDecryption(string memory metadata) public {
        euint32 count = encryptedMetadataCount[metadata];
        require(FHE.isInitialized(count), "Metadata not found");

        bytes32[] memory ciphertexts = new bytes32[](1);
        ciphertexts[0] = FHE.toBytes32(count);

        uint256 reqId = FHE.requestDecryption(ciphertexts, this.decryptMetadataCount.selector);
        requestToContentId[reqId] = uint256(keccak256(abi.encodePacked(metadata)));
    }

    function decryptMetadataCount(
        uint256 requestId,
        bytes memory cleartexts,
        bytes memory proof
    ) public {
        uint256 metadataHash = requestToContentId[requestId];
        string memory metadata = getMetadataFromHash(metadataHash);

        FHE.checkSignatures(requestId, cleartexts, proof);
        uint32 count = abi.decode(cleartexts, (uint32));
    }

    function bytes32ToUint(bytes32 b) private pure returns (uint256) {
        return uint256(b);
    }

    function getMetadataFromHash(uint256 hash) private view returns (string memory) {
        for (uint i = 0; i < metadataList.length; i++) {
            if (bytes32ToUint(keccak256(abi.encodePacked(metadataList[i]))) == hash) {
                return metadataList[i];
            }
        }
        revert("Metadata not found");
    }
}
