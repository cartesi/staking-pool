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
    const { deployments, getNamedAccounts, network } = hre;
    const { deploy } = deployments;
    const { deployer } = await getNamedAccounts();
    const { StakingPoolImpl } = await deployments.all();

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

    // deploy pool factory
    await deploy("StakingPoolFactoryImpl", {
        args: [StakingPoolImpl.address, chainlinkOracle, uniswapOracle],
        from: deployer,
        log: true,
    });
};

export default func;
export const tags = ["PoolFactory"];
export const dependencies = ["Pool"];
