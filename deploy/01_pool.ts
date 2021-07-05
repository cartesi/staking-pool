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

const func: DeployFunction = async (hre: HardhatRuntimeEnvironment) => {
    const { deployments, getNamedAccounts, ethers, network } = hre;
    const { deploy } = deployments;
    const { deployer } = await getNamedAccounts();
    const { CartesiToken, PoS, StakingImpl, WorkerManagerAuthManagerImpl } =
        await deployments.all();

    const ethNetwork = await ethers.getDefaultProvider().getNetwork();
    const ensAddress = ethNetwork.ensAddress || ethers.constants.AddressZero;

    // deploy reference pool
    const timeToStake =
        network.name == "mainnet" || network.name == "ropsten"
            ? 6 * HOUR
            : 2 * MINUTE;
    const timeToRelease =
        network.name == "mainnet" || network.name == "ropsten"
            ? 2 * DAY
            : 2 * MINUTE;
    await deploy("StakingPoolImpl", {
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
};

export default func;
export const tags = ["Pool"];
