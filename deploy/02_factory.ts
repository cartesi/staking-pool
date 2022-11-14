// Copyright 2022 Cartesi Pte. Ltd.

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
    hre: HardhatRuntimeEnvironment,
    name: string
): Promise<string> => {
    const { deployments, getNamedAccounts, ethers, network } = hre;
    const { deploy } = deployments;
    const { deployer } = await getNamedAccounts();
    const deployment = await deploy(name, {
        from: deployer,
        contract: "MockAggregator",
        log: true,
    });
    return deployment.address;
};

const func: DeployFunction = async (hre: HardhatRuntimeEnvironment) => {
    const { deployments, getNamedAccounts, network } = hre;
    const { PoS } = await deployments.all();
    const { deploy } = deployments;
    const { deployer } = await getNamedAccounts();

    const chainlinkGasPriceOracle =
        network.config.chainId === 1
            ? "0x169E633A2D1E6c10dD91238Ba11c4A708dfEF37C" // https://data.chain.link/fast-gas-gwei
            : await deployChainlink(hre, "GasAggregator");
    const gasOracle = await deploy("ChainlinkGasOracle", {
        args: [chainlinkGasPriceOracle],
        from: deployer,
        log: true,
    });

    const chainlinkPriceOracle =
        network.config.chainId === 1
            ? "0x0a1d1b9847d602e789be38B802246161FFA24930" // https://data.chain.link/ethereum/mainnet/crypto-eth/ctsi-eth
            : await deployChainlink(hre, "PriceAggregator");
    const priceOracle = await deploy("ChainlinkPriceOracle", {
        args: [chainlinkPriceOracle],
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
            gasOracle.address,
            priceOracle.address,
            PoS.address,
            feeRaiseTimeout,
            20000,
            500,
        ],
        from: deployer,
        log: true,
    });
};

func.tags = ["PoolFactory"];
func.dependencies = ["Staking"];
export default func;
