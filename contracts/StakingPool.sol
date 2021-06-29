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

import "@cartesi/pos/contracts/IStaking.sol";
import "./StakingPoolManagement.sol";

interface StakingPool is IStaking, StakingPoolManagement {
    ///@notice this events is emitted at every produceBlock call
    ///     reward is the block reward
    ///     commission is how much CTSI is directed to the poolManager
    ///     queued is how much currently is being queued to be staked
    ///     notStaked is how much is directed to withdrawal
    event BlockProduced(
        uint256 reward,
        uint256 commission,
        uint256 queued,
        uint256 notStaked
    );

    /// @notice routes produceBlock to POS contract and
    /// updates internal states of the pool
    /// @return true when everything went fine
    function produceBlock(uint256 _index) external returns (bool);

    /// @notice enables pool manager to update staking balances as they mature
    /// on the (main) Staking contract
    function cycleStakeMaturation() external;

    /// @notice enables pool manager to update releasing balances as they get freed
    /// on the (main) Staking contract
    function cycleWithdrawRelease() external;

    /// @notice checks whether or not a call can be made to cycleStakeMaturation
    /// and be successful
    /// @return available true if cycleStakeMaturation can bee called
    ///                   false if it can not
    ///         _currentQueuedTotal how much is waiting to be staked
    function canCycleStakeMaturation()
        external
        view
        returns (bool available, uint256 _currentQueuedTotal, uint256 _currentMaturingTotal);

    /// @notice checks whether or not a call can be made to cycleWithdrawRelease
    /// and be successful
    /// @return available true if cycleWithdrawRelease can bee called
    ///                   false if it can not
    ///         _totalToUnstakeValue how much is waiting to be unstaked
    function canCycleWithdrawRelease()
        external
        view
        returns (bool available, uint256 _totalToUnstakeValue, uint256 _totalUnstaking);
}
