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
import "./interfaces/StakingPoolUser.sol";
import "./StakingPoolData.sol";

contract StakingPoolUserImpl is StakingPoolUser, StakingPoolData {
    IERC20 private immutable ctsi;
    uint256 lockTime;

    /// @dev Constructor
    /// @param _ctsi The contract that provides the staking pool's token
    constructor(address _ctsi) {
        ctsi = IERC20(_ctsi);
    }

    /// @param _lockTime The user stake lock period
    function __StakingPoolUser_init(uint256 _lockTime) internal {
        lockTime = _lockTime;
    }

    /// @notice Stake an amount of tokens, immediately earning pool shares in returns
    /// @param _amount amount of tokens deposited in the pool
    function stake(uint256 _amount) public override whenNotPaused {
        // transfer tokens from caller to this contract
        // user must have approved the transfer a priori
        // tokens will be lying around, until actually staked by pool owner at a later time
        require(
            _amount > 0,
            "StakingPoolUserImpl: amount must be greater than 0"
        );
        require(
            ctsi.transferFrom(msg.sender, address(this), _amount),
            "StakingPoolUserImpl: failed to transfer tokens"
        );

        // calculate amount of shares as of now
        uint256 _shares = amountToShares(_amount);

        // make sure he get at least one share (rounding errors)
        require(
            _shares > 0,
            "StakingPoolUserImpl: stake not enough to emit 1 share"
        );

        UserBalance storage user = userBalance[msg.sender];

        // allocate new shares to user, immediately
        user.shares += _shares;

        // lock his shares for a period of time
        // this may reset a previously set lock time
        user.unstakeTimestamp = block.timestamp + lockTime;

        // increase total shares and amount (not changing share value)
        amount += _amount;
        shares += _shares;

        // emit event containing user, amount, shares and unlock time
        emit Stake(msg.sender, _amount, _shares, user.unstakeTimestamp);
    }

    /// @notice allow for users to defined exactly how many shares they
    /// want to unstake. Estimated value is then emitted on Unstake event
    function unstake(uint256 _shares) public override {
        UserBalance storage user = userBalance[msg.sender];

        // check if shares is valid value
        require(_shares > 0, "StakingPoolUserImpl: invalid amount of shares");

        // check if user has enough shares to unstake
        require(
            user.shares >= _shares,
            "StakingPoolUserImpl: insufficient shares"
        );

        // check if user can already unstake or if it's still locked
        require(
            block.timestamp > user.unstakeTimestamp,
            "StakingPoolUserImpl: stake locked"
        );

        // reduce user number of shares
        user.shares -= _shares;

        // calculate amount of tokens from shares
        uint256 _amount = sharesToAmount(_shares);

        // reduce total shares and amount
        shares -= _shares;
        amount -= _amount;

        // add amout user can withdraw (if available)
        user.released += _amount;

        // increase required liquidity
        requiredLiquidity += _amount;

        // emit event containing user, amount and shares
        emit Unstake(msg.sender, _amount, _shares);
    }

    /// @notice Transfer tokens back to calling user wallet
    /// @dev this will transfer all free tokens for the calling user
    function withdraw() public override {
        UserBalance storage user = userBalance[msg.sender];
        uint256 _amount = user.released;

        // check user released value
        require(_amount > 0, "StakingPoolUserImpl: no balance to withdraw");

        // transfer token back to user
        require(
            ctsi.transfer(msg.sender, _amount),
            "StakingPoolUserImpl: failed to transfer tokens"
        );

        // clear user released value
        user.released = 0;

        // decrease required liquidity
        requiredLiquidity -= _amount;

        // emit event containing user and token amount
        emit Withdraw(msg.sender, _amount);
    }

    function getWithdrawBalance() public view override returns (uint256) {
        UserBalance storage user = userBalance[msg.sender];

        // get amount user requested
        uint256 _amount = user.released;

        // check contract balance, if it has enough, let him get it
        uint256 balance = ctsi.balanceOf(address(this));

        // only allow full withdraw, so if contract has enough, let him get it
        return balance >= _amount ? _amount : 0;
    }
}
