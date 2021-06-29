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
pragma experimental ABIEncoderV2;
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@cartesi/pos/contracts/IRewardManager.sol";
import "@cartesi/pos/contracts/IStaking.sol";
import "./StakingPool.sol";
import "./Fee.sol";
import "./StakingPoolManagementImpl.sol";

contract StakingPoolImpl is StakingPool, StakingPoolManagementImpl {
    IERC20 public immutable ctsi;
    IStaking public immutable staking;

    Fee public fee;
    uint256 public rewardQueued;
    uint256 public rewardNotStaked;
    uint256 public rewardMaturing;
    uint256 public currentStakeEpoch;
    uint256 public currentUnstakeEpoch;

    uint256 public immutable timeToStake;
    uint256 public immutable timeToRelease;

    struct StakingVoucher {
        uint256 amountQueued;
        uint256 amountStaked;
        uint256 queueEpoch;
    }

    struct UnstakingVoucher {
        uint256 poolShares;
        uint256 queueEpoch;
    }

    struct UserBalance {
        // @TODO improve state usage reducing variable sizes
        uint256 stakedPoolShares;
        StakingVoucher stakingVoucher;
        UnstakingVoucher unstakingVoucher;
    }
    mapping(address => UserBalance) public userBalance;
    uint256 public immutable FIXED_POINT_DECIMALS = 10E5; //@DEV is this enough zero/precision?
    // this gets updated on every reward income
    uint256[] public stakingVoucherValueAtEpoch; // correction factor for balances outdated by new rewards
    uint256 public currentQueuedTotal; // next cycle staking amout
    uint256 public currentMaturingTotal; // current cycle staking maturing
    uint256 public totalStaked; // "same as" StakeImp.getStakedBalance(this)
    uint256 public totalStakedShares;
    // this tracks the ratio of balances to actual CTSI value
    // withdraw related variables
    uint256 public totalToUnstakeShares; // next withdraw cycle unstake amount
    uint256 public totalUnstaking; // current withdraw cycle unstaking amount
    uint256 public totalWithdrawable; // ready to withdraw user balances
    uint256 public totalUnstakedShares; // tracks shares balances

    // all immutable variables can stay at the constructor
    constructor(
        address _ctsi,
        address _staking,
        address _pos,
        uint256 _timeToStake,
        uint256 _timeToRelease,
        address _ens,
        address _workerManager
    ) StakingPoolManagementImpl(_ens, _workerManager, _pos) {
        require(_ctsi != address(0), "parameter can not be zero address");
        require(_staking != address(0), "parameter can not be zero address");

        ctsi = IERC20(_ctsi);
        staking = IStaking(_staking);
        timeToStake = _timeToStake;
        timeToRelease = _timeToRelease;
    }

    function initialize(address _feeAddress, address owner) public initializer {
        super.initialize(owner);
        require(
            ctsi.approve(address(staking), type(uint256).max),
            "Failed to approve CTSI for staking contract"
        );
        fee = Fee(_feeAddress);
    }

    /// @notice Returns total amount of tokens counted as stake
    /// @param _userAddress user to retrieve staked balance from
    /// @return stakedBalance is the finalized staked of _userAddress
    function getStakedBalance(address _userAddress)
        external
        view
        override
        returns (uint256 stakedBalance)
    {
        UserBalance storage b = userBalance[_userAddress];
        uint256 shares = _getUserMaturatedShares(b.stakingVoucher);
        uint256 withdrawBalance;
        uint256 stakedValue = 0;
        // since it didn't call staking.unstake() yet, it's balance still counts for reward
        if (b.unstakingVoucher.queueEpoch < currentUnstakeEpoch)
            withdrawBalance = b.unstakingVoucher.poolShares;
        if (totalStakedShares > 0) {
            shares += b.stakedPoolShares - withdrawBalance;
            stakedValue = _getStakedSharesInValue(shares);
        }
        if (staking.getMaturingTimestamp(address(this)) < block.timestamp) {
            // effectively 1 cycle has passed and we didn't compute yet
            uint256 _currentStakeEpoch = currentStakeEpoch + 1;
            if (b.stakingVoucher.queueEpoch + 1 == _currentStakeEpoch) {
                stakedValue += b.stakingVoucher.amountStaked;
            } else if (b.stakingVoucher.queueEpoch + 2 == _currentStakeEpoch) {
                stakedValue += b.stakingVoucher.amountQueued;
            }
        }

        return stakedValue;
    }

    /// @notice Returns the timestamp when next deposit can be finalized
    /// @return timestamp of when cycleStakeMaturation() is callable
    function getMaturingTimestamp(address _userAddress)
        external
        view
        override
        returns (uint256)
    {
        if (
            userBalance[_userAddress].stakingVoucher.queueEpoch + 1 ==
            currentStakeEpoch
        ) return staking.getMaturingTimestamp(address(this));
        if (
            userBalance[_userAddress].stakingVoucher.queueEpoch ==
            currentStakeEpoch
        ) return staking.getMaturingTimestamp(address(this)) + timeToStake;
        return 0;
    }

    /// @notice Returns the timestamp when next withdraw can be finalized
    /// @return timestamp of when withdraw() is callable
    function getReleasingTimestamp(address _userAddress)
        external
        view
        override
        returns (uint256)
    {
        uint256 wEpoch = userBalance[_userAddress].unstakingVoucher.queueEpoch;
        if (wEpoch + 1 == currentUnstakeEpoch) {
            return staking.getReleasingTimestamp(address(this));
        } else if (
            staking.getReleasingBalance(address(this)) > 0 &&
            wEpoch == currentUnstakeEpoch
        ) {
            return staking.getReleasingTimestamp(address(this)) + timeToRelease;
        } else if (wEpoch == currentUnstakeEpoch) {
            return block.timestamp + timeToRelease;
        }
        return 0;
    }

    /// @notice Returns the balance waiting/ready to be matured
    /// @return amount that will get staked after finalization
    function getMaturingBalance(address _userAddress)
        external
        view
        override
        returns (uint256)
    {
        UserBalance storage b = userBalance[_userAddress];
        uint256 maturingBalance = 0;
        uint256 _currentStakeEpoch = currentStakeEpoch;
        if (staking.getMaturingTimestamp(address(this)) < block.timestamp)
            _currentStakeEpoch++;
        // if more than one cycle has passed for amountStaked then it's vested already
        if (b.stakingVoucher.queueEpoch + 1 > _currentStakeEpoch)
            maturingBalance += b.stakingVoucher.amountStaked;
        // if more than 2 cycles has passed for amountQueued then it's vested already
        if (b.stakingVoucher.queueEpoch + 2 > _currentStakeEpoch)
            maturingBalance += b.stakingVoucher.amountQueued;
        return maturingBalance;
    }

    /// @notice Returns the balance waiting/ready to be released
    /// @return amount that will get withdrawn after finalization
    function getReleasingBalance(address _userAddress)
        external
        view
        override
        returns (uint256)
    {
        UnstakingVoucher storage voucher =
            userBalance[_userAddress].unstakingVoucher;
        // releasing balance still was not unstaked on IStaking
        if (voucher.queueEpoch == currentUnstakeEpoch && totalStakedShares != 0)
            return _getStakedSharesInValue(voucher.poolShares);

        // releasing(ed) balance was unstaked on IStaking
        if (
            voucher.queueEpoch + 1 <= currentUnstakeEpoch &&
            totalUnstakedShares != 0
        ) return _getUnstakedSharesInValue(voucher.poolShares);
        // avoid division by zero in some scenarios
        return 0;
    }

    /// @notice Deposit CTSI to be staked. The money will turn into staked
    ///         balance after timeToStake days
    /// @param _amount The amount of tokens that are gonna be additionally deposited.
    function stake(uint256 _amount) external override whenNotPaused {
        require(
            ctsi.transferFrom(msg.sender, address(this), _amount),
            "Allowance of CTSI tokens not enough to match amount sent"
        );
        _stakeUpdates(msg.sender, _amount);
    }

    /// @notice routes produceBlock to POS contract and
    /// updates internal states of the pool
    /// @return true when everything went fine
    function produceBlock(uint256 _index) external override returns (bool) {
        bool isLastStakeCycleOver =
            staking.getMaturingTimestamp(address(this)) <= block.timestamp;
        if (isLastStakeCycleOver) computeFinishedStake();

        uint256 reward =
            IRewardManager(pos.getRewardManagerAddress(_index))
                .getCurrentReward();

        pos.produceBlock(_index);

        uint256 commission = fee.getCommission(_index, reward);
        _stakeUpdates(owner(), commission); // directs the commission to the pool manager

        uint256 remainingReward = reward - commission; // this is also a safety check
        // if commission is over the reward amount, it will underflow

        // we first route rewards related to unstakingShares to withdrawal
        // then we add the rest to the staking queue
        uint256 additionalRewardsWithdrawal =
            _calcUnstakingRewards(remainingReward + rewardQueued);
        rewardNotStaked += additionalRewardsWithdrawal;

        // update the possible remaining reward to be staked
        rewardQueued =
            (remainingReward + rewardQueued) -
            additionalRewardsWithdrawal;

        emit BlockProduced(reward, commission, rewardQueued, rewardNotStaked);

        if (isLastStakeCycleOver) startNewStakeCycle();
        cycleWithdrawRelease();
        return true;
    }

    /// @notice Remove tokens from staked balance. The money can
    ///         be released after timeToRelease seconds, if the
    ///         function withdraw is called.
    /// @param _amount The amount of tokens that are gonna be unstaked.
    function unstake(uint256 _amount) external override {
        UserBalance storage user = userBalance[msg.sender];
        require(
            user.unstakingVoucher.poolShares == 0 ||
                user.unstakingVoucher.queueEpoch == currentUnstakeEpoch,
            "You have withdraw being processed"
        );

        _updateUserBalances(msg.sender); // makes sure balances are updated to shares

        uint256 _amountInShares = _getStakedValueInShares(_amount);
        require(_amountInShares > 0, "there are no shares to be unstaked");
        user.unstakingVoucher.poolShares += _amountInShares;

        require(
            user.stakedPoolShares >= user.unstakingVoucher.poolShares,
            "Unstake amount is over staked balance"
        );

        totalToUnstakeShares += _amountInShares;
        user.unstakingVoucher.queueEpoch = currentUnstakeEpoch;

        uint256 releaseTimestamp;
        if (staking.getReleasingBalance(address(this)) > 0)
            releaseTimestamp = staking.getReleasingTimestamp(address(this));
        else {
            releaseTimestamp = block.timestamp;
        }

        emit Unstake(msg.sender, _amount, releaseTimestamp + timeToRelease);
    }

    /// @notice Transfer tokens to user's wallet.
    /// @param _amount The amount of tokens that are gonna be transferred.
    function withdraw(uint256 _amount) external override {
        UserBalance storage user = userBalance[msg.sender];
        require(
            user.unstakingVoucher.poolShares > 0 &&
                user.unstakingVoucher.queueEpoch + 2 <= currentUnstakeEpoch,
            "You don't have realeased balance"
        );
        _updateUserBalances(msg.sender); // makes sure balances are updated to matured
        uint256 shares = _getUnstakedValueInShares(_amount);
        require(
            user.unstakingVoucher.poolShares >= shares,
            "Not enough balance for this withdraw amount"
        );
        user.unstakingVoucher.poolShares -= shares;
        user.stakedPoolShares -= shares;

        totalWithdrawable -= _amount;
        totalUnstakedShares -= shares;
        ctsi.transfer(msg.sender, _amount);
        emit Withdraw(msg.sender, _amount);
    }

    function _calcUnstakingRewards(uint256 rewards)
        internal
        view
        returns (uint256)
    {
        // @dev review this function when totalStakedShares is Zero.
        // total value related to totalStakedShares
        uint256 totalAccumulatedValue =
            totalStaked + rewardMaturing + rewardNotStaked + rewards;
        // value that will be made available to withdraw in the next full withdraw cycle
        uint256 totalToUnstakeValue =
            (totalToUnstakeShares * totalAccumulatedValue) / totalStakedShares;
        // additional value related to current rewards yet to be set aside
        uint256 toUnstakeValueNotAccounted =
            totalToUnstakeValue - rewardNotStaked;
        if (rewards > toUnstakeValueNotAccounted)
            return toUnstakeValueNotAccounted;
        return rewards; // all this reward will be added to rewardNotStaked
    }

    function _calcValueAtEpoch() internal view returns (uint256) {
        // first time weight is 1
        if (currentStakeEpoch == 1) {
            return FIXED_POINT_DECIMALS;
        }
        // the `ValueAtEpoch` factor is the same as 1 unit of value in shares
        return _getStakedValueInShares(1);
    }

    function _calcTotalShares(uint256 valueAtEpoch)
        internal
        view
        returns (uint256)
    {
        // rewards do not count shares, so we subtract them
        uint256 newStakedValue = currentMaturingTotal - rewardMaturing;
        uint256 additionalShares = newStakedValue * valueAtEpoch;
        return totalStakedShares + additionalShares;
    }

    /// @notice called when a stake is matured in StakeImpl
    /// updating internal state related to it
    function computeFinishedStake() internal {
        if (currentStakeEpoch >= 1) {
            uint256 _valueAtEpoch = _calcValueAtEpoch();
            totalStakedShares = _calcTotalShares(_valueAtEpoch);
            stakingVoucherValueAtEpoch.push(_valueAtEpoch);
            totalStaked = totalStaked + currentMaturingTotal;
            // now we add this because we migth have intermediate
            // calculations that use this state var
            currentMaturingTotal = 0;
        }
    }

    /// @notice called after the finish of cycle
    /// to start with a new stake and reset global state vars
    function startNewStakeCycle() internal {
        currentMaturingTotal = currentQueuedTotal + rewardQueued;
        if (currentMaturingTotal != 0) staking.stake(currentMaturingTotal);
        rewardMaturing = rewardQueued;
        rewardQueued = 0;
        currentQueuedTotal = 0;
        currentStakeEpoch++;
    }

    /// @notice enables pool manager to update staking balances as they mature
    /// on the (main) Staking contract
    function cycleStakeMaturation() public override {
        bool isLastStakeCycleOver =
            staking.getMaturingTimestamp(address(this)) <= block.timestamp;
        if (!isLastStakeCycleOver) return;
        computeFinishedStake();
        startNewStakeCycle();
    }

    /// @notice enables pool manager to update staking balances as they mature
    /// on the (main) Staking contract
    function cycleWithdrawRelease() public override {
        uint256 releasingBalance = staking.getReleasingBalance(address(this));
        if (
            releasingBalance > 0 &&
            staking.getReleasingTimestamp(address(this)) > block.timestamp
        ) return; // last release cycle hasn't finished

        if (totalToUnstakeShares == 0 && totalUnstaking == 0) return; // nothing to do

        // withdraw everything to this contract before reseting the clock
        if (releasingBalance > 0) staking.withdraw(releasingBalance);

        uint256 totalToUnstake = 0;
        if (totalToUnstakeShares > 0) {
            totalToUnstake =
                _getStakedSharesInValue(totalToUnstakeShares) -
                rewardNotStaked;
            if (totalToUnstake > 0) {
                staking.unstake(totalToUnstake);
                totalStaked = totalStaked - totalToUnstake;
            }
        }

        // reset the cycle
        totalStakedShares -= totalToUnstakeShares;
        totalUnstakedShares += totalToUnstakeShares;
        totalToUnstakeShares = 0;
        totalWithdrawable += totalUnstaking + rewardNotStaked;
        rewardNotStaked = 0;
        totalUnstaking = totalToUnstake;
        currentUnstakeEpoch += 1;
    }

    /// @notice this function updates stale balance structure for a user
    /// it has basically 2 scenarios: user is staking since 1 epoch
    /// or it's staking since 2 or more epochs
    function _updateUserBalances(address _user) internal {
        UserBalance storage user = userBalance[_user];
        uint256 userLastUpdateEpoch = user.stakingVoucher.queueEpoch;
        if (
            (user.stakingVoucher.amountQueued == 0 &&
                user.stakingVoucher.amountStaked == 0) ||
            userLastUpdateEpoch == currentStakeEpoch
        ) return; // nothing to do; all up-to-date

        user.stakedPoolShares += _getUserMaturatedShares(user.stakingVoucher);
        // checks for any outdated balances
        if (userLastUpdateEpoch + 1 == currentStakeEpoch) {
            user.stakingVoucher.amountStaked = user.stakingVoucher.amountQueued;
            user.stakingVoucher.amountQueued = 0;
            user.stakingVoucher.queueEpoch = currentStakeEpoch;
        } else if (userLastUpdateEpoch + 2 <= currentStakeEpoch) {
            user.stakingVoucher.amountStaked = 0;
            user.stakingVoucher.amountQueued = 0;
        }
    }

    function _stakeUpdates(address user, uint256 _amount) internal {
        _updateUserBalances(user);

        userBalance[user].stakingVoucher.amountQueued =
            userBalance[user].stakingVoucher.amountQueued +
            _amount;
        userBalance[user].stakingVoucher.queueEpoch = currentStakeEpoch;

        currentQueuedTotal = currentQueuedTotal + _amount;

        emit Stake(
            user,
            _amount,
            staking.getMaturingTimestamp(address(this)) + timeToStake
        );
    }

    function _getStakedValueInShares(uint256 value)
        internal
        view
        returns (uint256 shares)
    {
        uint256 rewardsNotStaked =
            rewardMaturing + rewardQueued + rewardNotStaked;
        // total value related to totalStakedShares
        uint256 totalAccumulatedValue = totalStaked + rewardsNotStaked;
        if (totalAccumulatedValue == 0) return 0;
        return (value * totalStakedShares) / totalAccumulatedValue;
    }

    function _getStakedSharesInValue(uint256 shares)
        internal
        view
        returns (uint256 value)
    {
        if (totalStakedShares == 0) return 0;
        uint256 rewardsNotStaked =
            rewardMaturing + rewardNotStaked + rewardQueued;
        // total value related to totalStakedShares
        uint256 totalAccumulatedValue = totalStaked + rewardsNotStaked;
        return (shares * totalAccumulatedValue) / totalStakedShares;
    }

    function _getUnstakedSharesInValue(uint256 shares)
        internal
        view
        returns (uint256 value)
    {
        if (totalUnstakedShares == 0) return 0;
        // total value related to totalUnstakedShares
        uint256 totalAccumulatedValue = totalUnstaking + totalWithdrawable;
        return (shares * totalAccumulatedValue) / totalUnstakedShares;
    }

    function _getUnstakedValueInShares(uint256 value)
        internal
        view
        returns (uint256 shares)
    {
        // total value related to totalUnstakedShares
        uint256 totalAccumulatedValue = totalUnstaking + totalWithdrawable;
        if (totalAccumulatedValue == 0) return 0;
        return (value * totalUnstakedShares) / totalAccumulatedValue;
    }

    function _getUserMaturatedShares(StakingVoucher storage v)
        internal
        view
        returns (uint256 shares)
    {
        // check whether any balance under 'amountQueued' is already mature
        if (v.queueEpoch + 2 <= currentStakeEpoch) {
            shares = v.amountQueued * stakingVoucherValueAtEpoch[v.queueEpoch];
        }
        // check whether any balance under 'amountStaked' is already mature
        if (v.queueEpoch > 0 && v.queueEpoch + 1 <= currentStakeEpoch) {
            shares +=
                v.amountStaked *
                stakingVoucherValueAtEpoch[v.queueEpoch - 1];
        }
    }

    function canCycleStakeMaturation()
        external
        view
        override
        returns (
            bool available,
            uint256 _currentQueuedTotal,
            uint256 _currentMaturingTotal
        )
    {
        if (staking.getMaturingTimestamp(address(this)) > block.timestamp)
            return (false, currentQueuedTotal, currentMaturingTotal);
        return (true, currentQueuedTotal, currentMaturingTotal);
    }

    function canCycleWithdrawRelease()
        external
        view
        override
        returns (
            bool available,
            uint256 _totalToUnstakeValue,
            uint256 _totalUnstaking
        )
    {
        _totalToUnstakeValue = _getStakedSharesInValue(totalToUnstakeShares);
        if (
            staking.getReleasingBalance(address(this)) > 0 &&
            staking.getReleasingTimestamp(address(this)) > block.timestamp
        ) return (false, _totalToUnstakeValue, totalUnstaking);
        return (true, _totalToUnstakeValue, totalUnstaking);
    }
}
