// Copyright 2021 Cartesi Pte. Ltd.

// SPDX-License-Identifier: Apache-2.0
// Licensed under the Apache License, Version 2.0 (the "License"); you may not use
// this file except in compliance with the License. You may obtain a copy of the
// License at http://www.apache.org/licenses/LICENSE-2.0

// Unless required by applicable law or agreed to in writing, software distributed
// under the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR
// CONDITIONS OF ANY KIND, either express or implied. See the License for the
// specific language governing permissions and limitations under the License.

pragma solidity ^0.8.0;

import "@cartesi/pos/contracts/IWorkerManagerAuthManager.sol";
import "./interfaces/StakingPoolWorker.sol";
import "./StakingPoolData.sol";

contract StakingPoolWorkerImpl is StakingPoolWorker, StakingPoolData {
    address private immutable pos;

    IWorkerManagerAuthManager private immutable workerManager;

    // all immutable variables can stay at the constructor
    constructor(address _workerManager, address _pos) {
        require(
            _workerManager != address(0),
            "parameter can not be zero address"
        );
        require(_pos != address(0), "parameter can not be zero address");

        workerManager = IWorkerManagerAuthManager(_workerManager);
        pos = _pos;
    }

    receive() external payable {}

    /// @notice allows for the pool to act on its own behalf when producing blocks.
    function selfhire() external payable override {
        // pool needs to be both user and worker
        workerManager.hire{value: msg.value}(payable(address(this)));
        workerManager.authorize(address(this), pos);
        workerManager.acceptJob();
        payable(msg.sender).transfer(msg.value);
    }

    /// @notice Asks the worker to work for the sender. Sender needs to pay something.
    /// @param workerAddress address of the worker
    function hire(address payable workerAddress)
        external
        payable
        override
        onlyOwner
    {
        workerManager.hire{value: msg.value}(workerAddress);
        workerManager.authorize(workerAddress, pos);
    }

    /// @notice Called by the user to cancel a job offer
    /// @param workerAddress address of the worker node
    function cancelHire(address workerAddress) external override onlyOwner {
        workerManager.cancelHire(workerAddress);
    }

    /// @notice Called by the user to retire his worker.
    /// @param workerAddress address of the worker to be retired
    /// @dev this also removes all authorizations in place
    function retire(address payable workerAddress) external override onlyOwner {
        workerManager.retire(workerAddress);
    }
}
