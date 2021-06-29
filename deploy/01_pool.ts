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
 * Deploy a mock contract for uniswap pair, where anyone can set price.
 * @param hre hardhat environment
 * @returns contract address
 */
const deployUniswap = async (
    hre: HardhatRuntimeEnvironment
): Promise<string> => {
    const { deployments, getNamedAccounts, ethers, network } = hre;
    const { deploy } = deployments;
    const { deployer } = await getNamedAccounts();
    const deployment = await deploy("MockUniswapV2Pair", {
        from: deployer,
        log: true,
    });
    return deployment.address;
};

const func: DeployFunction = async (hre: HardhatRuntimeEnvironment) => {
    const { deployments, getNamedAccounts, ethers, network } = hre;
    const { deploy } = deployments;
    const { deployer } = await getNamedAccounts();
    const { CartesiToken, PoS, StakingImpl, WorkerManagerAuthManagerImpl } =
        await deployments.all();

    const ethNetwork = await ethers.getDefaultProvider().getNetwork();
    const ensAddress = ethNetwork.ensAddress || ethers.constants.AddressZero;

    network.config.chainId === 1;

    const chainlinkOracle =
        network.config.chainId === 1
            ? "0x169E633A2D1E6c10dD91238Ba11c4A708dfEF37C" // https://data.chain.link/fast-gas-gwei
            : await deployChainlink(hre);

    const uniswapOracle =
        network.config.chainId === 1
            ? "0x58EEB5D44Dc41965AB0a9E563536175C8dc5C3B3" // https://v2.info.uniswap.org/pair/0x58eeb5d44dc41965ab0a9e563536175c8dc5c3b3
            : await deployUniswap(hre);
    // XXX: Uniswap V3 is at https://info.uniswap.org/#/pools/0x01949723055a451229c7ba3a817937c966748f76

    // deploy reference pool
    const timeToStake = hre.network.name == "mainnet" ? 6 * HOUR : 2 * MINUTE;
    const timeToRelease = hre.network.name == "mainnet" ? 2 * DAY : 2 * MINUTE;
    const StakingPool = await deploy("StakingPoolImpl", {
        args: [
            CartesiToken.address,
            StakingImpl.address,
            PoS.address,
            timeToStake,
            timeToRelease,
            ensAddress,
            WorkerManagerAuthManagerImpl.address,
        ],
        from: deployer,
        log: true,
    });

    // deploy pool factory
    await deploy("StakingPoolFactoryImpl", {
        args: [StakingPool.address, chainlinkOracle, uniswapOracle],
        from: deployer,
        log: true,
    });
};

export default func;
export const tags = ["Pool"];
