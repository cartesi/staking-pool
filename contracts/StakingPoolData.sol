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

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts/security/Pausable.sol";

contract StakingPoolData is Ownable, Initializable, Pausable {
    uint256 public shares; // total number of shares
    uint256 public amount; // amount of staked tokens (no matter where it is)
    uint256 public requiredLiquidity; // amount of required tokens for withdraw requests

    struct UserBalance {
        uint256 shares; // amount of shares beloging to this user
        uint256 released; // amount of tokens released to this user
        uint256 unstakeTimestamp; // timestamp of when user can unstake
    }
    mapping(address => UserBalance) public userBalance;

    constructor() {}

    function amountToShares(uint256 _amount) public view returns (uint256) {
        // TODO: rounding errors
        return (_amount * shares) / amount;
    }

    function sharesToAmount(uint256 _shares) public view returns (uint256) {
        // TODO: rounding errors
        return (_shares * amount) / shares;
    }
}