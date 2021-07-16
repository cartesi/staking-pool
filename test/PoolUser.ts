// Copyright 2021 Cartesi Pte. Ltd.

// Licensed under the Apache License, Version 2.0 (the "License"); you may not use
// this file except in compliance with the License. You may obtain a copy of the
// License at http://www.apache.org/licenses/LICENSE-2.0

// Unless required by applicable law or agreed to in writing, software distributed
// under the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR
// CONDITIONS OF ANY KIND, either express or implied. See the License for the
// specific language governing permissions and limitations under the License.

import { expect, use } from "chai";
import { deployments, ethers, waffle } from "hardhat";
import { JsonRpcProvider } from "@ethersproject/providers";

import { CartesiToken__factory } from "@cartesi/token";
import { StakingPoolImpl__factory } from "../src/types/factories/StakingPoolImpl__factory";

import { advanceTime, setNextBlockTimestamp } from "./utils";
import { PoS__factory } from "@cartesi/pos";
const { solidity, deployMockContract } = waffle;

use(solidity);
const MINUTE = 60; // seconds in a minute
const HOUR = 60 * MINUTE; // seconds in an hour
const STAKE_LOCK = 60; // seconds

const parseCTSI = (value: string) => ethers.utils.parseUnits(value, 18);

describe("StakingPoolUser", async () => {
    beforeEach(async () => {});

    const setupPool = deployments.createFixture(
        async ({ deployments, ethers }, options) => {
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
            const fee = await deployMockContract(
                deployer,
                commissionArtifact.abi
            );
            await fee.mock.getCommission.returns(commission);

            // setup token distribution
            const token = CartesiToken__factory.connect(
                CartesiToken.address,
                deployer
            );
            // send 10k tokens to alice and bob
            await token.transfer(alice.address, parseCTSI("10000"));
            await token.transfer(bob.address, parseCTSI("10000"));

            const pool = StakingPoolImpl__factory.connect(
                StakingPoolImpl.address,
                deployer
            );
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

    it("should not allow unstake of zero shares", async () => {
        const { alice } = await setupPool();
        await expect(alice.pool.unstake(0)).to.revertedWith(
            "StakingPoolUserImpl: invalid amount of shares"
        );
    });

    it("should not allow unstake with no shares", async () => {
        const { alice } = await setupPool();
        await expect(alice.pool.unstake(1)).to.revertedWith(
            "StakingPoolUserImpl: insufficient shares"
        );
    });

    it("should not allow stake zero tokens", async () => {
        const { alice } = await setupPool();
        await expect(alice.pool.stake(0)).to.revertedWith(
            "StakingPoolUserImpl: amount must be greater than 0"
        );
    });

    it("should not stake what user don't have", async () => {
        const { alice } = await setupPool();
        await expect(alice.pool.stake(parseCTSI("100000"))).to.be.revertedWith(
            "ERC20: transfer amount exceeds balance"
        );
    });

    it("should not stake what user didn't allow", async () => {
        const { alice } = await setupPool();
        await expect(alice.pool.stake(parseCTSI("1000"))).to.be.revertedWith(
            "ERC20: transfer amount exceeds allowance"
        );
    });

    it("should successfully stake", async () => {
        const { alice } = await setupPool();
        const stake = parseCTSI("1000");
        await alice.token.approve(alice.pool.address, stake);

        // control time
        const ts = Date.now();
        await setNextBlockTimestamp(alice.pool.provider, ts);

        await expect(alice.pool.stake(stake))
            .to.emit(alice.pool, "Stake")
            .withArgs(alice.address, stake, stake, ts + STAKE_LOCK);

        // at start shares = amount
        expect(await alice.pool.shares()).to.equal(stake);
        expect(await alice.pool.amount()).to.equal(stake);
        const balance = await alice.pool.userBalance(alice.address);
        expect(balance.shares).to.equal(stake);
        expect(balance.unstakeTimestamp).to.equal(ts + STAKE_LOCK);
        expect(balance.released).to.equal(0);
    });

    it("should not allow to receive zero shares", async () => {
        const { alice, bob, owner } = await setupPool();

        // stake 1e-18 tokens, earn 1e-18 shares
        await alice.token.approve(alice.pool.address, 1);
        await alice.pool.stake(1);
        expect((await alice.pool.userBalance(alice.address)).shares).to.equal(
            1
        );

        // stake to staking
        await owner.pool.rebalance();

        // advance time to mature stake
        advanceTime(owner.pool.provider, 6 * HOUR);

        // produce a block
        await owner.pool.produceBlock(0);

        // bob tries to stake same as alice, but it's not enough to emit a single share
        await bob.token.approve(bob.pool.address, 1);
        await expect(bob.pool.stake(1)).to.revertedWith(
            "StakingPoolUserImpl: stake not enough to emit 1 share"
        );
    });

    it("should lock stake", async () => {
        const { alice } = await setupPool();
        const stake = parseCTSI("1000");
        await alice.token.approve(alice.pool.address, stake);

        const ts = Date.now();
        setNextBlockTimestamp(alice.pool.provider, ts);
        await alice.pool.stake(stake);

        // only 10 seconds after stake
        setNextBlockTimestamp(alice.pool.provider, ts + 10);

        await expect(alice.pool.unstake(stake)).to.be.revertedWith(
            "StakingPoolUserImpl: stake locked"
        );
    });

    it("should successfully unstake", async () => {
        const { alice } = await setupPool();
        const stake = parseCTSI("1000");
        const unstake = stake.div(4);
        await alice.token.approve(alice.pool.address, stake);

        const ts = Date.now();
        setNextBlockTimestamp(alice.pool.provider, ts);
        await alice.pool.stake(stake);
        setNextBlockTimestamp(alice.pool.provider, ts + STAKE_LOCK + 1);

        await expect(alice.pool.unstake(unstake))
            .to.emit(alice.pool, "Unstake")
            .withArgs(alice.address, unstake, unstake);

        // total shares and amount should decrease
        expect(await alice.pool.shares()).to.equal(stake.sub(unstake));
        expect(await alice.pool.amount()).to.equal(stake.sub(unstake));

        // user shares and amount should decrease
        const balance = await alice.pool.userBalance(alice.address);
        expect(balance.shares).to.equal(stake.sub(unstake));

        // relesed should increase
        expect(balance.released).to.equal(unstake);

        // required liquidity should increase
        expect(await alice.pool.requiredLiquidity()).to.equal(unstake);
    });

    it("should not withdraw with no user balance", async () => {
        const { alice } = await setupPool();
        await expect(alice.pool.withdraw()).to.be.revertedWith(
            "StakingPoolUserImpl: no balance to withdraw"
        );
    });

    it("should withdraw right after unstake", async () => {
        const { alice } = await setupPool();
        const stake = parseCTSI("1000");
        const unstake = stake.div(4);
        await alice.token.approve(alice.pool.address, stake);

        // stake
        const ts = Date.now();
        setNextBlockTimestamp(alice.pool.provider, ts);
        await alice.pool.stake(stake);

        // unstake 1/4
        setNextBlockTimestamp(alice.pool.provider, ts + STAKE_LOCK + 1);
        await alice.pool.unstake(unstake);

        // unstake request liquidity
        expect(await alice.pool.requiredLiquidity()).to.equal(unstake);

        await expect(alice.pool.withdraw())
            .to.emit(alice.pool, "Withdraw")
            .withArgs(alice.address, unstake);

        const balance = await alice.pool.userBalance(alice.address);
        expect(balance.released).to.equal(0);

        // decrease liquidity
        expect(await alice.pool.requiredLiquidity()).to.equal(0);
    });

    it("should not withdraw with no pool balance", async () => {
        const { alice } = await setupPool();
        const stake = parseCTSI("1000");
        const unstake = stake.div(4);
        await alice.token.approve(alice.pool.address, stake);

        // stake
        const ts = Date.now();
        setNextBlockTimestamp(alice.pool.provider, ts);
        await alice.pool.stake(stake);

        // stake to staking
        await alice.pool.rebalance();

        // unstake 1/4
        setNextBlockTimestamp(alice.pool.provider, ts + STAKE_LOCK + 1);
        await alice.pool.unstake(unstake);

        // should not have balance
        expect(await alice.pool.getWithdrawBalance()).to.equal(0);

        await expect(alice.pool.withdraw()).to.be.revertedWith(
            "ERC20: transfer amount exceeds balance"
        );
    });
});
