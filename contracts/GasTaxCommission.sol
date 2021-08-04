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

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@chainlink/contracts/src/v0.8/interfaces/AggregatorInterface.sol";
import "@uniswap/v2-core/contracts/interfaces/IUniswapV2Pair.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "./interfaces/Fee.sol";
import "./oracle/GasOracle.sol";

contract GasTaxCommission is Fee, Ownable {
    GasOracle public immutable gasOracle;

    IUniswapV2Pair public immutable priceOracle;

    uint256 public gas;

    /// @notice event fired when setGas function is called and successful
    event GasTaxChanged(uint256 newGas);

    constructor(
        address _chainlinkOracle,
        address _uniswapOracle,
        uint256 _gas
    ) {
        gasOracle = GasOracle(_chainlinkOracle);
        priceOracle = IUniswapV2Pair(_uniswapOracle);
        gas = _gas;
        emit GasTaxChanged(_gas);
    }

    /// @notice calculates the total amount of the reward that will be directed to the PoolManager
    /// @return commissionTotal is the amount subtracted from the rewardAmount
    function getCommission(uint256, uint256 rewardAmount)
        external
        view
        override
        returns (uint256)
    {
        // get gas price from chainlink oracle
        // https://data.chain.link/fast-gas-gwei#operator-chainlayer
        uint256 gasPrice = gasOracle.getGasPrice();

        // gas fee (in ETH) charged by pool manager
        uint256 gasFee = gasPrice * gas;

        // get CTSI/ETH reserves
        (
            uint112 reserveCTSI,
            uint112 reserveETH,
            uint32 _blockTimestampLast
        ) = priceOracle.getReserves();

        // convert gas in ETH to gas in CTSI

        // if there is no ETH reserve, we can't calculate
        if (reserveETH == 0) {
            return 0;
        }
        uint256 gasFeeCTSI = (gasFee * reserveCTSI) / reserveETH;

        // this is the commission, maxed by the reward
        return gasFeeCTSI > rewardAmount ? rewardAmount : gasFeeCTSI;
    }

    /// @notice allows for the poolManager to reduce how much they want to charge for the block production tx
    function setGas(uint256 newGasCommission) external onlyOwner {
        require(
            newGasCommission < gas,
            "newGasCommission needs to be strictly smaller than the current value."
        );
        gas = newGasCommission;
        emit GasTaxChanged(newGasCommission);
    }
}
