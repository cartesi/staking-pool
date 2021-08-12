// Copyright 2021 Cartesi Pte. Ltd.

// Licensed under the Apache License, Version 2.0 (the "License"); you may not use
// this file except in compliance with the License. You may obtain a copy of the
// License at http://www.apache.org/licenses/LICENSE-2.0

// Unless required by applicable law or agreed to in writing, software distributed
// under the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR
// CONDITIONS OF ANY KIND, either express or implied. See the License for the
// specific language governing permissions and limitations under the License.

import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

const defaultNetworksChainIDs = [1, 3, 4, 5];
const MINUTE = 60; // seconds in a minute
const HOUR = 60 * MINUTE; // seconds in an hour
const DAY = 24 * HOUR; // seconds in a day
/**
 * Deploy a mock contract for a chainlink aggregator, where anyone can set the value.
 * @param hre hardhat environment
 * @returns contract address
 */
const deployChainlink = async (
    hre: HardhatRuntimeEnvironment
): Promise<string> => {
    const { deployments, getNamedAccounts, ethers, network } = hre;
    const { deploy } = deployments;
    const { deployer } = await getNamedAccounts();
    const deployment = await deploy("MockAggregator", {
        from: deployer,
        log: true,
    });
    return deployment.address;
};

/**
 * Deploy a UniswapV3Factory.
 * @param hre hardhat environment
 * @returns contract address
 */
const deployUniswapV3Factory = async (
    hre: HardhatRuntimeEnvironment
): Promise<string> => {
    const { deployments, getNamedAccounts } = hre;
    const { deploy } = deployments;
    const { deployer } = await getNamedAccounts();
    const contract = await import(
        "@uniswap/v3-core/artifacts/contracts/UniswapV3Factory.sol/UniswapV3Factory.json"
    );
    const factory = await deploy("UniswapV3Factory", {
        contract,
        from: deployer,
        log: true,
    });
    return factory.address;
};

const deployWETH = async (hre: HardhatRuntimeEnvironment): Promise<string> => {
    const { deployments, getNamedAccounts } = hre;
    const { deploy } = deployments;
    const { deployer } = await getNamedAccounts();
    const contract = await import(
        "@openzeppelin/contracts/build/contracts/ERC20.json"
    );
    const factory = await deploy("ERC20", {
        contract,
        args: ["Wrapped Ether", "WETH"],
        from: deployer,
        log: true,
    });
    return factory.address;
};

const getUniswapV3FactoryAddress = async (
    hre: HardhatRuntimeEnvironment
): Promise<string> => {
    const { network } = hre;
    if (
        network.config.chainId &&
        defaultNetworksChainIDs.includes(network.config.chainId)
    )
        return "0x1F98431c8aD98523631AE4a59f267346ea31F984";
    return deployUniswapV3Factory(hre);
};

const getWETHAddress = async (
    hre: HardhatRuntimeEnvironment
): Promise<string> => {
    const { network } = hre;
    switch (network.config.chainId) {
        case 1: // mainnet
            return "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2";
        case 3: //ropsten
            return "0xc778417E063141139Fce010982780140Aa0cD5Ab";
        case 5: //goerli
            return "0xB4FBF271143F4FBf7B91A5ded31805e42b2208d6"; // 0xf5E7Aa9fD045CE55c68F9a4f80A608496f152524
        default:
            return await deployWETH(hre);
    }
};

const func: DeployFunction = async (hre: HardhatRuntimeEnvironment) => {
    const { deployments, getNamedAccounts, network } = hre;
    const { deploy } = deployments;
    const { deployer } = await getNamedAccounts();
    const { CartesiToken } = await deployments.all();

    network.config.chainId === 1;

    const chainlinkOracle =
        network.config.chainId === 1
            ? "0x169E633A2D1E6c10dD91238Ba11c4A708dfEF37C" // https://data.chain.link/fast-gas-gwei
            : await deployChainlink(hre);
    const GasOracle = await deploy("ChainlinkGasOracle", {
        args: [chainlinkOracle],
        from: deployer,
        log: true,
    });

    // deploy UniswapV3 price oracle
    // https://info.uniswap.org/#/pools/0x01949723055a451229c7ba3a817937c966748f76
    const uniswapV3FactoryAddress = await getUniswapV3FactoryAddress(hre);
    const weth = await getWETHAddress(hre);

    const uniswapV3Oracle = await deploy("UniswapV3PriceOracle", {
        args: [uniswapV3FactoryAddress, CartesiToken.address, weth],
        from: deployer,
        log: true,
    });

    let feeRaiseTimeout;

    switch (hre.network.name) {
        case "mainnet":
        case "ropsten":
            feeRaiseTimeout = 7 * DAY;
            break;
        case "hardhat":
        case "goerli":
        default:
            feeRaiseTimeout = 2 * MINUTE;
    }

    // deploy pool factory
    await deploy("StakingPoolFactoryImpl", {
        args: [
            GasOracle.address,
            uniswapV3Oracle.address,
            feeRaiseTimeout,
            20000,
            500,
        ],
        from: deployer,
        log: true,
    });
};

export default func;
export const tags = ["PoolFactory"];
export const dependencies = ["Pool"];
