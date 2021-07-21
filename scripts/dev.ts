// Copyright 2021 Cartesi Pte. Ltd.

// Licensed under the Apache License, Version 2.0 (the "License"); you may not use
// this file except in compliance with the License. You may obtain a copy of the
// License at http://www.apache.org/licenses/LICENSE-2.0

// Unless required by applicable law or agreed to in writing, software distributed
// under the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR
// CONDITIONS OF ANY KIND, either express or implied. See the License for the
// specific language governing permissions and limitations under the License.

import { PoS__factory } from "@cartesi/pos";
import hre from "hardhat";
import { CartesiToken__factory } from "@cartesi/token";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import { StakingPoolFactoryImpl__factory } from "../src/types";

const setupFactory = async (hre: HardhatRuntimeEnvironment) => {
    const { ethers, deployments } = hre;
    const { StakingPoolImpl, StakingPoolFactoryImpl } = await deployments.all();
    const [signer] = await ethers.getSigners();

    const factory = StakingPoolFactoryImpl__factory.connect(
        StakingPoolFactoryImpl.address,
        signer
    );

    // set reference pool
    console.log(
        `Setting reference pool ${StakingPoolImpl.address} to factory ${StakingPoolFactoryImpl.address}`
    );
    await factory.setReferencePool(StakingPoolImpl.address);
};

const setupChain = async (hre: HardhatRuntimeEnvironment) => {
    const { ethers, deployments } = hre;
    const {
        BlockSelector,
        CartesiToken,
        PoS,
        StakingImpl,
        WorkerManagerAuthManagerImpl,
    } = await deployments.all();
    const reward = ethers.utils.parseUnits("2900", 18);
    const [signer] = await ethers.getSigners();

    // instantiate chain
    const pos = PoS__factory.connect(PoS.address, signer);

    console.log(`Instantiating PoS chain with a ${reward.toString()} reward`);
    await pos.instantiate(
        StakingImpl.address,
        BlockSelector.address,
        WorkerManagerAuthManagerImpl.address,
        "1000000000",
        "100000000000000000000000000",
        50000,
        56,
        CartesiToken.address,
        reward,
        reward,
        10000,
        10000
    );

    const token = CartesiToken__factory.connect(CartesiToken.address, signer);
    const rewardManager = await pos.getRewardManagerAddress(0);
    const rewards = reward.mul(1000);
    console.log(
        `Transfering ${rewards.toString()} tokens to RewardManager ${rewardManager}`
    );
    await token.transfer(rewardManager, reward.mul(1000));
};

async function main() {
    await setupFactory(hre);
    await setupChain(hre);
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });
