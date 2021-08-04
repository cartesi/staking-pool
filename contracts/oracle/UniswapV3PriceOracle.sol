// Copyright 2021 Cartesi Pte. Ltd.

// SPDX-License-Identifier: Apache-2.0
// Licensed under the Apache License, Version 2.0 (the "License"); you may not use
// this file except in compliance with the License. You may obtain a copy of the
// License at http://www.apache.org/licenses/LICENSE-2.0

// Unless required by applicable law or agreed to in writing, software distributed
// under the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR
// CONDITIONS OF ANY KIND, either express or implied. See the License for the
// specific language governing permissions and limitations under the License.

pragma solidity >=0.5.0 <0.8.0;

import "@uniswap/v3-core/contracts/interfaces/IUniswapV3Factory.sol";
import {OracleLibrary} from "@uniswap/v3-periphery/contracts/libraries/OracleLibrary.sol";
import "./PriceOracle.sol";

contract UniswapV3PriceOracle is PriceOracle {
    address public immutable pool;
    address public immutable weth;
    address public immutable ctsi;

    uint32 constant period = 30 minutes;

    constructor(
        address _factory,
        address _ctsi,
        address _weth
    ) {
        uint24 fee = 3000; // use the 3000 fee = 60 tick
        IUniswapV3Factory factory = IUniswapV3Factory(_factory);

        // get pool from factory
        address _pool = factory.getPool(_ctsi, _weth, fee);
        if (_pool == address(0)) {
            // pool does not exist, create one (testnet)
            _pool = factory.createPool(_ctsi, _weth, fee);
        }

        pool = _pool;
        weth = _weth;
        ctsi = _ctsi;
    }

    /// @notice Returns current network gas price
    /// @return value of gas price
    function getPrice() public view override returns (uint256) {
        // get the time weighted average tick (TWAT)
        int24 timeWeightedAverageTick = OracleLibrary.consult(pool, period);

        // convert tick to price (TWAP)
        uint256 price = OracleLibrary.getQuoteAtTick(
            timeWeightedAverageTick,
            1,
            weth,
            ctsi
        );
        return price;
    }
}
