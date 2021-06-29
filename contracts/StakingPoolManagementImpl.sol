// Copyright 2021 Cartesi Pte. Ltd.

// SPDX-License-Identifier: Apache-2.0
// Licensed under the Apache License, Version 2.0 (the "License"); you may not use
// this file except in compliance with the License. You may obtain a copy of the
// License at http://www.apache.org/licenses/LICENSE-2.0

// Unless required by applicable law or agreed to in writing, software distributed
// under the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR
// CONDITIONS OF ANY KIND, either express or implied. See the License for the
// specific language governing permissions and limitations under the License.

/// @title Interface staking contract
pragma solidity ^0.8.0;

import "@cartesi/pos/contracts/IPoS.sol";
import "@cartesi/pos/contracts/IWorkerManagerAuthManager.sol";
import "@ensdomains/ens-contracts/contracts/registry/ReverseRegistrar.sol";
import "@ensdomains/ens-contracts/contracts/registry/ENS.sol";
import "@openzeppelin/contracts/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts/security/Pausable.sol";

import "./StakingPoolManagement.sol";

contract StakingPoolManagementImpl is
    StakingPoolManagement,
    Initializable,
    Pausable
{
    bytes32 private constant ADDR_REVERSE_NODE =
        0x91d1777781884d03a6757a803996e38de2a42967fb37eeaca72729271025a9e2;

    ENS public immutable ens;
    IPoS public immutable pos;

    IWorkerManagerAuthManager public immutable workerManager;

    event OwnershipTransferred(
        address indexed previousOwner,
        address indexed newOwner
    );

    address private _owner;

    // all immutable variables can stay at the constructor
    constructor(
        address _ens,
        address _workerManager,
        address _pos
    ) {
        require(_ens != address(0), "parameter can not be zero address");
        require(
            _workerManager != address(0),
            "parameter can not be zero address"
        );
        require(_pos != address(0), "parameter can not be zero address");

        ens = ENS(_ens);
        workerManager = IWorkerManagerAuthManager(_workerManager);
        pos = IPoS(_pos);
        // make sure reference code is pause so noone stake to it
        initialize(address(0));
        _pause();
    }

    function initialize(address ownerSender) internal initializer {
        _owner = ownerSender;
        emit OwnershipTransferred(address(0), ownerSender);
    }

    receive() external payable {}

    /// @notice sets a name for the pool using ENS service
    function setName(string memory name) external override onlyOwner {
        ReverseRegistrar ensReverseRegistrar =
            ReverseRegistrar(ens.owner(ADDR_REVERSE_NODE));

        // call the ENS reverse registrar resolving pool address to name
        ensReverseRegistrar.setName(name);

        // emit event, for subgraph processing
        emit StakingPoolRenamed(name);
    }

    /// @notice pauses new staking on the pool
    function pause() public override onlyOwner {
        _pause();
    }

    /// @notice unpauses new staking on the pool
    function unpause() external override onlyOwner {
        _unpause();
    }

    /// @notice allows for the pool to act on its own behalf when producing blocks.
    function selfhire() external payable override {
        // pool needs to be both user and worker
        workerManager.hire{value: msg.value}(payable(address(this)));
        workerManager.authorize(address(this), address(pos));
        workerManager.acceptJob();
        payable(_owner).transfer(msg.value);
    }

    /// @notice Asks the worker to work for the sender. Sender needs to pay something.
    /// @param workerAddress address of the worker
    function hire(address payable workerAddress) external payable override {
        workerManager.hire{value: msg.value}(workerAddress);
        workerManager.authorize(workerAddress, address(pos));
    }

    /// @notice Called by the user to cancel a job offer
    /// @param workerAddress address of the worker node
    function cancelHire(address workerAddress) external override {
        workerManager.cancelHire(workerAddress);
    }

    /// @notice Called by the user to retire his worker.
    /// @param workerAddress address of the worker to be retired
    /// @dev this also removes all authorizations in place
    function retire(address payable workerAddress) external override {
        workerManager.retire(workerAddress);
    }

    /**
     * @dev Throws if called by any account other than the owner.
     */
    modifier onlyOwner() {
        require(_owner == msg.sender, "Ownable: caller is not the owner");
        _;
    }

    /**
     * @dev Transfers ownership of the contract to a new account (`newOwner`).
     * Can only be called by the current owner.
     */
    function transferOwnership(address newOwner) public virtual onlyOwner {
        require(
            newOwner != address(0),
            "Ownable: new owner is the zero address"
        );
        emit OwnershipTransferred(_owner, newOwner);
        _owner = newOwner;
    }

    /**
     * @dev Leaves the contract without owner. It will not be possible to call
     * `onlyOwner` functions anymore. Can only be called by the current owner.
     *
     * NOTE: Renouncing ownership will leave the contract without an owner,
     * thereby removing any functionality that is only available to the owner.
     */
    function renounceOwnership() public virtual onlyOwner {
        emit OwnershipTransferred(_owner, address(0));
        _owner = address(0);
    }

    /**
     * @dev Returns the address of the current owner.
     */
    function owner() public view virtual returns (address) {
        return _owner;
    }
}
