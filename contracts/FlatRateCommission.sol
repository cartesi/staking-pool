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

import "@openzeppelin/contracts/access/Ownable.sol";
import "./Fee.sol";

contract FlatRateCommission is Fee, Ownable {
    uint256 public BASE = 1E4;
    uint256 public rate;

    /// @notice Event emmited when a contract is created
    /// @param commission commission charged by the pool
    event FlatRateCommissionCreated(uint256 commission);

    /// @notice event fired when setRate function is called and successful
    event FlatRateChanged(uint256 newRate);

    constructor(uint256 _rate) {
        rate = _rate;
        emit FlatRateChanged(_rate);
    }

    /// @notice calculates the total amount of the reward that will be directed to the PoolManager
    /// @return commissionTotal is the amount subtracted from the rewardAmount
    function getCommission(uint256, uint256 rewardAmount)
        external
        view
        override
        returns (uint256)
    {
        return (rewardAmount * rate) / BASE;
    }

    /// @notice allows for the poolManager to reduce how much they want to charge for the block production tx
    function setRate(uint256 newRate) external onlyOwner {
        require(
            newRate < rate,
            "newRate needs to be strictly smaller than current rate."
        );
        rate = newRate;
        emit FlatRateChanged(newRate);
    }
}
