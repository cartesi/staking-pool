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

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@cartesi/pos/contracts/IPoS.sol";
import "@cartesi/pos/contracts/IRewardManager.sol";
import "./interfaces/Fee.sol";
import "./interfaces/StakingPoolProducer.sol";
import "./StakingPoolData.sol";

contract StakingPoolProducerImpl is StakingPoolProducer, StakingPoolData {
    IERC20 public immutable ctsi;
    IPoS public immutable pos;
    Fee public fee;

    constructor(address _ctsi, address _pos) {
        ctsi = IERC20(_ctsi);
        pos = IPoS(_pos);
    }

    function __StakingPoolProducer_init(address _fee) public {
        fee = Fee(_fee);
    }

    /// @notice routes produceBlock to POS contract and
    /// updates internal states of the pool
    /// @return true when everything went fine
    function produceBlock(uint256 _index) external override returns (bool) {
        IRewardManager rewardManager = IRewardManager(
            pos.getRewardManagerAddress(_index)
        );

        // get block reward
        uint256 reward = rewardManager.getCurrentReward();

        // produce block in the PoS
        pos.produceBlock(_index);

        // calculate pool commission
        // TODO: where do we require that fee is initialized?
        uint256 commission = fee.getCommission(_index, reward);
        require(
            commission <= reward,
            "StakingPoolProducerImpl: commission is greater than block reward"
        );

        // send commission directly to pool owner
        if (commission > 0) {
            require(
                ctsi.transfer(owner(), commission),
                "StakingPoolProducerImpl: failed to transfer commission"
            );
        }

        uint256 remainingReward = reward - commission; // this is a safety check
        // if commission is over the reward amount, it will underflow

        // increase pool amount, this will change the pool exchange rate
        amount += remainingReward;

        // remainingReward is part of the balance, so it will automatically be staked by StakingPoolStakingImpl
        emit BlockProduced(reward, commission);

        return true;
    }
}
