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
import "@openzeppelin/contracts/proxy/Clones.sol";
import "@openzeppelin/contracts/security/Pausable.sol";
import "./StakingPoolFactory.sol";
import "./StakingPoolImpl.sol";
import "./FlatRateCommission.sol";
import "./GasTaxCommission.sol";

contract StakingPoolFactoryImpl is Ownable, Pausable, StakingPoolFactory {
    address public referencePool;
    address public immutable chainlinkOracle;
    address public immutable uniswapOracle;

    constructor(
        address _referencePool,
        address _chainlinkOracle,
        address _uniswapOracle
    ) {
        require(
            _referencePool != address(0),
            "parameter can not be zero address."
        );
        require(
            _chainlinkOracle != address(0),
            "parameter can not be zero address."
        );
        require(
            _uniswapOracle != address(0),
            "parameter can not be zero address."
        );
        referencePool = _referencePool;
        chainlinkOracle = _chainlinkOracle;
        uniswapOracle = _uniswapOracle;
    }

    /// @notice Change the pool reference implementation
    function setReferencePool(address _referencePool) public onlyOwner {
        referencePool = _referencePool;
    }

    /// @notice Creates a new staking pool
    /// emits NewStakingPool with the parameters of the new pool
    /// @return new pool address
    function createFlatRateCommission(uint256 commission)
        public
        payable
        override
        whenNotPaused
        returns (address)
    {
        FlatRateCommission fee = new FlatRateCommission(commission);
        address payable deployed = payable(Clones.clone(referencePool));
        StakingPoolImpl pool = StakingPoolImpl(deployed);
        pool.initialize(address(fee), msg.sender);
        fee.transferOwnership(msg.sender);
        pool.selfhire{value: msg.value}();

        emit NewFlatRateCommissionStakingPool(address(pool), address(fee));
        return address(pool);
    }

    function createGasTaxCommission(uint256 gas)
        public
        payable
        override
        whenNotPaused
        returns (address)
    {
        GasTaxCommission fee = new GasTaxCommission(
            chainlinkOracle,
            uniswapOracle,
            gas
        );
        address payable deployed = payable(Clones.clone(referencePool));
        StakingPoolImpl pool = StakingPoolImpl(deployed);
        pool.initialize(address(fee), msg.sender);
        fee.transferOwnership(msg.sender);
        pool.selfhire{value: msg.value}();

        emit NewGasTaxCommissionStakingPool(address(pool), address(fee));
        return address(pool);
    }

    function pause() public whenNotPaused onlyOwner {
        _pause();
    }

    function unpause() public whenPaused onlyOwner {
        _unpause();
    }
}
