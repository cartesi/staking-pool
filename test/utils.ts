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
import { deployENS, ENS } from "@ethereum-waffle/ens";
import { BigNumber } from "ethers";

import { PoS__factory, StakingImpl__factory } from "@cartesi/pos";

import { WorkerManagerAuthManagerImpl__factory } from "@cartesi/util";

import { CartesiToken__factory } from "@cartesi/token";
import { CloneMaker__factory, StakingPoolImpl__factory } from "../src/types";

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

export const WAD = ethers.BigNumber.from(10).pow(18);
export const RAY = ethers.BigNumber.from(10).pow(27);
export const WAD_RAY_RATIO = ethers.BigNumber.from(10).pow(9);

export const ray2wad = (a: BigNumber) => {
    const halfRatio = WAD_RAY_RATIO.div(2);
    return halfRatio.add(a).div(WAD_RAY_RATIO);
};

export const wad2ray = (a: BigNumber) => {
    return a.mul(WAD_RAY_RATIO);
};

export interface PoolProps {
    stakeLock?: number;
    selfHire?: boolean;
}

const MINUTE = 60; // seconds in a minute

export const setupPool = deployments.createFixture(
    async (
        { deployments, ethers }: HardhatRuntimeEnvironment,
        options: PoolProps = {}
    ) => {
        const stakeLock = options?.stakeLock || 60;
        const selfHire =
            options.selfHire === undefined ? true : options.selfHire || false;

        // start with a fresh deployment
        await deployments.fixture();

        const [deployer, alice, bob, node_worker] = await ethers.getSigners();
        const {
            BlockSelector,
            CartesiToken,
            StakingImpl,
            StakingPoolImpl,
            WorkerManagerAuthManagerImpl,
            PoS,
        } = await deployments.all();

        const workerManager = WorkerManagerAuthManagerImpl__factory.connect(
            WorkerManagerAuthManagerImpl.address,
            deployer
        );
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

        let referenceAddress;

        if (stakeLock == 2 * MINUTE) referenceAddress = StakingPoolImpl.address;
        else {
            const ensSvc: ENS = await deployENS(deployer);
            await ensSvc.createTopLevelDomain("test");
            const ensAddress = ensSvc.ens.address;
            const deployment = await deployments.deploy("StakingPoolImpl", {
                args: [
                    CartesiToken.address,
                    StakingImpl.address,
                    WorkerManagerAuthManagerImpl.address,
                    ensAddress,
                    stakeLock,
                ],
                from: deployer.address,
            });
            referenceAddress = deployment.address;
        }

        const CloneMakerFactory = new CloneMaker__factory(deployer);
        const cloneMaker = await CloneMakerFactory.deploy();
        const newPoolTx = await cloneMaker.clone(referenceAddress);
        const newPoolReceipt = await newPoolTx.wait();
        if (!newPoolReceipt.events || !newPoolReceipt.events[0].args)
            throw "error on cloning deployment";
        const newPoolAddr = newPoolReceipt.events[0].args[0];
        const pool = StakingPoolImpl__factory.connect(newPoolAddr, deployer);
        await pool.initialize(fee.address, PoS.address);

        // deploy a mock BlockSelector that always returns true to produceBlock
        const blockSelector = await deployMockContract(
            deployer,
            BlockSelector.abi
        );
        await blockSelector.mock.instantiate.returns(0);
        await blockSelector.mock.produceBlock.returns(true);
        await blockSelector.mock.canProduceBlock.returns(true);
        if (selfHire)
            await pool.selfhire({ value: ethers.utils.parseEther("0.001") });

        const staking = StakingImpl__factory.connect(
            StakingImpl.address,
            deployer
        );
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
                signer: deployer,
                address: deployer.address,
                pool: pool,
                token: token,
            },
            alice: {
                signer: alice,
                address: alice.address,
                pool: pool.connect(alice),
                token: token.connect(alice),
                workerManager: workerManager.connect(alice),
            },
            bob: {
                signer: bob,
                address: bob.address,
                pool: pool.connect(bob),
                token: token.connect(bob),
                workerManager: workerManager.connect(bob),
            },
            node_worker: {
                signer: node_worker,
                address: node_worker.address,
                pool: pool.connect(node_worker),
                token: token.connect(node_worker),
                workerManager: workerManager.connect(node_worker),
            },
            constants: {
                reward,
                commission,
            },
            contracts: {
                pos,
                fee,
                staking,
                workerManager,
            },
        };
    }
);
