// Copyright 2021 Cartesi Pte. Ltd.

// Licensed under the Apache License, Version 2.0 (the "License"); you may not use
// this file except in compliance with the License. You may obtain a copy of the
// License at http://www.apache.org/licenses/LICENSE-2.0

// Unless required by applicable law or agreed to in writing, software distributed
// under the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR
// CONDITIONS OF ANY KIND, either express or implied. See the License for the
// specific language governing permissions and limitations under the License.

import { use } from "chai";
import { deployments, ethers, waffle } from "hardhat";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import { JsonRpcProvider } from "@ethersproject/providers";
import { Provider } from "@ethersproject/abstract-provider";

import { PoS__factory } from "@cartesi/pos";
import { CartesiToken__factory } from "@cartesi/token";
import { StakingPoolImpl__factory } from "../src/types/factories/StakingPoolImpl__factory";
import { CloneMaker__factory } from "../src/types/factories/CloneMaker__factory";

const { solidity, deployMockContract } = waffle;
export const { parseEther: parseCTSI } = ethers.utils;

use(solidity);

export const advanceTime = async (provider: Provider, seconds: number) => {
    await (provider as JsonRpcProvider).send("evm_increaseTime", [seconds]);
};

export const advanceBlock = async (provider: Provider) => {
    await (provider as JsonRpcProvider).send("evm_mine", []);
};

export const setNextBlockTimestamp = async (provider: Provider, ts: number) => {
    await (provider as JsonRpcProvider).send("evm_setNextBlockTimestamp", [ts]);
};

export const advanceMultipleBlocks = async (
    provider: Provider,
    numOfBlocks: number
) => {
    for (let i = 0; i < numOfBlocks; i++) {
        await advanceBlock(provider);
    }
};

export const setupPool = deployments.createFixture(
    async (
        { deployments, ethers }: HardhatRuntimeEnvironment,
        { STAKE_LOCK }: { STAKE_LOCK: number } = { STAKE_LOCK: 60 }
    ) => {
        // const op = Object.assign({}, options);
        // const STAKE_LOCK = op.STAKE_LOCK ? op.STAKE_LOCK : 60;
        // start with a fresh deployment
        await deployments.fixture();

        const [deployer, alice, bob] = await ethers.getSigners();
        const {
            BlockSelector,
            CartesiToken,
            StakingImpl,
            StakingPoolImpl,
            WorkerManagerAuthManagerImpl,
        } = await deployments.all();

        // setup fee mock contract
        const reward = parseCTSI("2900");
        const commission = reward.div(10); // 10%
        const commissionArtifact = await deployments.getArtifact(
            "FlatRateCommission"
        );
        const fee = await deployMockContract(deployer, commissionArtifact.abi);
        await fee.mock.getCommission.returns(commission);

        // setup token distribution
        const token = CartesiToken__factory.connect(
            CartesiToken.address,
            deployer
        );
        // send 10k tokens to alice and bob
        await token.transfer(alice.address, parseCTSI("10000"));
        await token.transfer(bob.address, parseCTSI("10000"));
        const CloneMakerFactory = new CloneMaker__factory(deployer);
        const cloneMaker = await CloneMakerFactory.deploy();
        const newPoolTx = await cloneMaker.clone(StakingPoolImpl.address);
        const newPoolReceipt = await newPoolTx.wait();
        if (!newPoolReceipt.events || !newPoolReceipt.events[0].args)
            throw "error on cloning deployment";
        const newPoolAddr = newPoolReceipt.events[0].args[0];
        const pool = StakingPoolImpl__factory.connect(newPoolAddr, deployer);
        await pool.initialize(fee.address, STAKE_LOCK);

        // deploy a mock BlockSelector that always returns true to produceBlock
        const blockSelector = await deployMockContract(
            deployer,
            BlockSelector.abi
        );
        blockSelector.mock.instantiate.returns(0);
        blockSelector.mock.produceBlock.returns(true);
        blockSelector.mock.canProduceBlock.returns(true);
        await pool.selfhire({ value: ethers.utils.parseEther("0.001") });

        // instantiate a chain
        const pos = PoS__factory.connect(await pool.pos(), deployer);
        await pos.instantiate(
            StakingImpl.address,
            blockSelector.address,
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

        // feed the RewardManager with 10 block worth of tokens
        await token.transfer(
            await pos.getRewardManagerAddress(0),
            reward.mul(10)
        );

        return {
            owner: {
                address: deployer.address,
                pool: pool,
                token: token,
            },
            alice: {
                address: alice.address,
                pool: pool.connect(alice),
                token: token.connect(alice),
            },
            bob: {
                address: bob.address,
                pool: pool.connect(bob),
                token: token.connect(bob),
            },
        };
    }
);
