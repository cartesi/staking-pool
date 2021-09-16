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

import { deployENS, ENS } from "@ethereum-waffle/ens";

const MINUTE = 60; // seconds in a minute
const HOUR = 60 * MINUTE; // seconds in an hour

const func: DeployFunction = async (hre: HardhatRuntimeEnvironment) => {
    const { deployments, getNamedAccounts, ethers } = hre;
    const { deploy } = deployments;
    const { CartesiToken, StakingImpl, WorkerManagerAuthManagerImpl } =
        await deployments.all();
    const [deployer] = await ethers.getSigners();

    const ethNetwork = await ethers.getDefaultProvider().getNetwork();
    let ensAddress;
    if (hre.network.name != "hardhat") ensAddress = ethNetwork.ensAddress;
    else {
        const ensSvc: ENS = await deployENS(deployer);
        await ensSvc.createTopLevelDomain("test");
        ensAddress = ensSvc.ens.address;
    }
    let stakeLock;

    switch (hre.network.name) {
        case "mainnet":
        case "ropsten":
            stakeLock = 6 * HOUR;
            break;
        case "hardhat":
        default:
            stakeLock = 2 * MINUTE;
    }

    // deploy reference pool
    await deploy("StakingPoolImpl", {
        args: [
            CartesiToken.address,
            StakingImpl.address,
            WorkerManagerAuthManagerImpl.address,
            ensAddress,
            stakeLock,
        ],
        from: deployer.address,
        log: true,
    });
};

export default func;
export const tags = ["Pool"];
