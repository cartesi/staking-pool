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
import "@openzeppelin/contracts/access/Ownable.sol";
import "./interfaces/Fee.sol";
import "./oracle/GasOracle.sol";
import "./oracle/PriceOracle.sol";

contract GasTaxCommission is Fee, Ownable {
    uint256 public immutable feeRaiseTimeout;
    uint256 public immutable maxRaise = 20000; // 21000 is one simple tx
    GasOracle public immutable gasOracle;

    PriceOracle public immutable priceOracle;
    uint256 public timeoutTimestamp;

    uint256 public gas;

    /// @notice event fired when setGas function is called and successful
    /// @param timeout timestamp for a new change if raising the fee
    event GasTaxChanged(uint256 newGas, uint256 timeout);

    constructor(
        address _chainlinkOracle,
        address _uniswapOracle,
        uint256 _gas,
        uint256 _feeRaiseTimeout
    ) {
        gasOracle = GasOracle(_chainlinkOracle);
        priceOracle = PriceOracle(_uniswapOracle);
        gas = _gas;
        feeRaiseTimeout = _feeRaiseTimeout;
        emit GasTaxChanged(_gas, timeoutTimestamp);
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

        // convert gas in ETH to gas in CTSI
        uint256 ctsiETHPrice = priceOracle.getPrice();

        uint256 gasFeeCTSI = gasFee * ctsiETHPrice;

        // this is the commission, maxed by the reward
        return gasFeeCTSI > rewardAmount ? rewardAmount : gasFeeCTSI;
    }

    /// @notice allows for the poolManager to reduce how much they want to charge for the block production tx
    function setGas(uint256 newGasCommission) external onlyOwner {
        if (newGasCommission > gas) {
            require(
                timeoutTimestamp <= block.timestamp,
                "GasTaxCommission: the fee raise timout is not expired yet"
            );
            require(
                (newGasCommission - gas) <= maxRaise,
                "GasTaxCommission: the fee raise is over the maximum allowed gas value"
            );
            timeoutTimestamp = block.timestamp + feeRaiseTimeout;
        }
        gas = newGasCommission;
        emit GasTaxChanged(newGasCommission, timeoutTimestamp);
    }
}
