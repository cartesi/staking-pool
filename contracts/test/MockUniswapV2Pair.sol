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

import "@uniswap/v2-core/contracts/interfaces/IUniswapV2Pair.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract MockUniswapV2Pair is IUniswapV2Pair {
    uint112 _reserve0;
    uint112 _reserve1;
    uint32 _reserveTimestamp;

    constructor() {}

    function name() external pure override returns (string memory) {
        return "Cartesi-Ethereum";
    }

    function symbol() external pure override returns (string memory) {
        return "CTSI-ETH";
    }

    function decimals() external pure override returns (uint8) {
        return 18;
    }

    function totalSupply() external pure override returns (uint256) {
        return 0;
    }

    function balanceOf(address owner) external pure override returns (uint256) {
        return 0;
    }

    function allowance(address owner, address spender)
        external
        pure
        override
        returns (uint256)
    {
        return 0;
    }

    function approve(address spender, uint256 value)
        external
        pure
        override
        returns (bool)
    {
        return true;
    }

    function transfer(address to, uint256 value)
        external
        override
        returns (bool)
    {
        return true;
    }

    function transferFrom(
        address from,
        address to,
        uint256 value
    ) external pure override returns (bool) {
        return true;
    }

    function DOMAIN_SEPARATOR() external pure override returns (bytes32) {
        return 0x0;
    }

    function PERMIT_TYPEHASH() external pure override returns (bytes32) {
        return 0x0;
    }

    function nonces(address owner) external pure override returns (uint256) {
        return 0;
    }

    function permit(
        address owner,
        address spender,
        uint256 value,
        uint256 deadline,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external override {
        return;
    }

    function MINIMUM_LIQUIDITY() external pure override returns (uint256) {
        return 0;
    }

    function factory() external view override returns (address) {
        return address(this);
    }

    function token0() external pure override returns (address) {
        return address(0);
    }

    function token1() external pure override returns (address) {
        return address(0);
    }

    function setReserves(uint112 reserve0, uint112 reserve1) external {
        _reserve0 = reserve0;
        _reserve1 = reserve1;
        _reserveTimestamp = uint32(block.timestamp);
    }

    function getReserves()
        external
        view
        override
        returns (
            uint112 reserve0,
            uint112 reserve1,
            uint32 blockTimestampLast
        )
    {
        return (_reserve0, _reserve1, _reserveTimestamp);
    }

    function price0CumulativeLast() external pure override returns (uint256) {
        return 0;
    }

    function price1CumulativeLast() external pure override returns (uint256) {
        return 0;
    }

    function kLast() external pure override returns (uint256) {
        return 0;
    }

    function mint(address _to)
        external
        pure
        override
        returns (uint256 liquidity)
    {
        return 0;
    }

    function burn(address to)
        external
        override
        returns (uint256 amount0, uint256 amount1)
    {}

    function swap(
        uint256 amount0Out,
        uint256 amount1Out,
        address to,
        bytes calldata data
    ) external override {}

    function skim(address to) external override {}

    function sync() external override {}

    function initialize(address, address) external override {}
}
