// Copyright 2021 Cartesi Pte. Ltd.

// SPDX-License-Identifier: Apache-2.0
// Licensed under the Apache License, Version 2.0 (the "License"); you may not use
// this file except in compliance with the License. You may obtain a copy of the
// License at http://www.apache.org/licenses/LICENSE-2.0

// Unless required by applicable law or agreed to in writing, software distributed
// under the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR
// CONDITIONS OF ANY KIND, either express or implied. See the License for the
// specific language governing permissions and limitations under the License.

/// @title Factory of staking pools
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/proxy/Clones.sol";
import "@openzeppelin/contracts/security/Pausable.sol";
import "./interfaces/StakingPool.sol";
import "./interfaces/StakingPoolFactory.sol";
import "./FlatRateCommission.sol";
import "./GasTaxCommission.sol";

contract StakingPoolFactoryImpl is Ownable, Pausable, StakingPoolFactory {
    address public referencePool;
    address public immutable gasOracle;
    address public immutable priceOracle;
    uint256 public immutable feeRaiseTimeout;
    uint256 public immutable maxGasRaise;
    uint256 public immutable maxFeePercentageRaise;

    event ReferencePoolChanged(address indexed pool);

    receive() external payable {}

    constructor(
        address _gasOracle,
        address _priceOracle,
        uint256 _feeRaiseTimeout,
        uint256 _maxGasRaise,
        uint256 _maxFeePercentageRaise
    ) {
        require(
            _gasOracle != address(0),
            "StakingPoolFactoryImpl: parameter can not be zero address."
        );
        require(
            _priceOracle != address(0),
            "StakingPoolFactoryImpl: parameter can not be zero address."
        );
        gasOracle = _gasOracle;
        priceOracle = _priceOracle;
        feeRaiseTimeout = _feeRaiseTimeout;
        maxGasRaise = _maxGasRaise;
        maxFeePercentageRaise = _maxFeePercentageRaise;
    }

    /// @notice Change the pool reference implementation
    function setReferencePool(address _referencePool) external onlyOwner {
        referencePool = _referencePool;
        emit ReferencePoolChanged(_referencePool);
    }

    /// @notice Creates a new staking pool
    /// emits NewStakingPool with the parameters of the new pool
    /// @return new pool address
    function createFlatRateCommission(uint256 commission)
        external
        payable
        override
        whenNotPaused
        returns (address)
    {
        require(
            referencePool != address(0),
            "StakingPoolFactoryImpl: undefined reference pool"
        );
        FlatRateCommission fee = new FlatRateCommission(
            commission,
            feeRaiseTimeout,
            maxFeePercentageRaise
        );
        address payable deployed = payable(Clones.clone(referencePool));
        StakingPool pool = StakingPool(deployed);
        pool.initialize(address(fee));
        pool.transferOwnership(msg.sender);
        fee.transferOwnership(msg.sender);
        // sends msg.value to complete hiring process
        pool.selfhire{value: msg.value}(); //@dev: ignore reentrancy guard warning

        // returns unused user payment
        payable(msg.sender).transfer(msg.value); //@dev: ignore reentrancy guard warning

        emit NewFlatRateCommissionStakingPool(address(pool), address(fee));
        return address(pool);
    }

    function createGasTaxCommission(uint256 gas)
        external
        payable
        override
        whenNotPaused
        returns (address)
    {
        require(
            referencePool != address(0),
            "StakingPoolFactoryImpl: undefined reference pool"
        );
        GasTaxCommission fee = new GasTaxCommission(
            gasOracle,
            priceOracle,
            gas,
            feeRaiseTimeout,
            maxGasRaise
        );
        address payable deployed = payable(Clones.clone(referencePool));
        StakingPool pool = StakingPool(deployed);
        pool.initialize(address(fee));
        pool.transferOwnership(msg.sender);
        fee.transferOwnership(msg.sender);
        // sends msg.value to complete hiring process
        pool.selfhire{value: msg.value}(); //@dev: ignore reentrancy guard warning

        // returns unused user payment
        payable(msg.sender).transfer(msg.value); //@dev: ignore reentrancy guard warning

        emit NewGasTaxCommissionStakingPool(address(pool), address(fee));
        return address(pool);
    }

    function pause() external whenNotPaused onlyOwner {
        _pause();
    }

    function unpause() external whenPaused onlyOwner {
        _unpause();
    }
}
