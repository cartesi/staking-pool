// Copyright 2021 Cartesi Pte. Ltd.

// Licensed under the Apache License, Version 2.0 (the "License"); you may not use
// this file except in compliance with the License. You may obtain a copy of the
// License at http://www.apache.org/licenses/LICENSE-2.0

// Unless required by applicable law or agreed to in writing, software distributed
// under the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR
// CONDITIONS OF ANY KIND, either express or implied. See the License for the
// specific language governing permissions and limitations under the License.

import { expect, use } from "chai";
import { waffle } from "hardhat";

import { setNextBlockTimestamp, setupPool, parseCTSI } from "./utils";
const { solidity } = waffle;

use(solidity);
const MINUTE = 60; // seconds in a minute
const HOUR = 60 * MINUTE; // seconds in an hour
const STAKE_LOCK = 60; // seconds
const timeToStake = 2 * MINUTE;
const timeToRelease = 2 * MINUTE;

describe("StakingPoolProducer", async () => {
    it("should correctly produce a block", async () => {
        const {
            owner,
            constants: { reward, commission },
            contracts: { pos },
        } = await setupPool({ stakeLock: STAKE_LOCK });

        const beforeBalance = await owner.token.balanceOf(owner.address);
        const tx = owner.pool.produceBlock(0);
        await expect(tx)
            .to.emit(owner.pool, "BlockProduced")
            .withArgs(reward, commission);

        await expect(tx)
            .to.emit(pos, "Rewarded")
            .withArgs(0, owner.pool.address, owner.pool.address, reward);

        const afterBalance = await owner.token.balanceOf(owner.address);

        expect(afterBalance.sub(beforeBalance)).to.be.equal(commission);
        expect(await owner.pool.amount()).to.be.equal(reward.sub(commission));
    });

    it("should fail to produce a block on illegal commission", async () => {
        const {
            owner,
            constants: { reward, commission },
            contracts: { fee },
        } = await setupPool({ stakeLock: STAKE_LOCK });

        await fee.mock.getCommission.returns(reward.add(1));

        await expect(owner.pool.produceBlock(0)).to.be.revertedWith(
            "StakingPoolProducerImpl: commission is greater than block reward"
        );
    });

    it("should distribute rewards according to shares", async () => {
        const {
            alice,
            bob,
            owner,
            constants: { reward, commission },
            contracts: { staking },
        } = await setupPool({});
        const provider = owner.pool.provider;
        const stake = parseCTSI("1000");

        await alice.token.approve(alice.pool.address, stake);
        await bob.token.approve(bob.pool.address, stake.mul(9));

        await alice.pool.stake(stake);
        // bob is staking 9 times the amount of alice
        // so he should earn 90% of the rewards
        await bob.pool.stake(stake.mul(9));

        // stake to staking
        const ts = Date.now();
        await setNextBlockTimestamp(provider, ts);
        await expect(owner.pool.rebalance()).to.emit(staking, "Stake");
        await owner.pool.produceBlock(0);

        const aliceBalance = await alice.pool.userBalance(alice.address);
        const bobBalance = await bob.pool.userBalance(bob.address);

        expect(aliceBalance.shares.mul(9)).to.be.equal(bobBalance.shares);

        await setNextBlockTimestamp(provider, ts + STAKE_LOCK + 1);

        // actual reward to users is the block reward - commission
        const remainingReward = reward.sub(commission);
        // alice should only take 10% of the reward
        const aliceExpectedBalance = stake.add(remainingReward.div(10));
        // and bob should take 90%
        const bobExpectedBalance = stake
            .mul(9)
            .add(remainingReward.mul(9).div(10));

        await expect(alice.pool.unstake(aliceBalance.shares))
            .to.emit(alice.pool, "Unstake")
            .withArgs(alice.address, aliceExpectedBalance, aliceBalance.shares);

        await expect(bob.pool.unstake(bobBalance.shares))
            .to.emit(bob.pool, "Unstake")
            .withArgs(bob.address, bobExpectedBalance, bobBalance.shares);

        // this will call stakingImpl.unstake()
        const maturingTS = await staking.getMaturingTimestamp(
            owner.pool.address
        );
        await setNextBlockTimestamp(provider, maturingTS.toNumber() + 1);
        await expect(owner.pool.rebalance()).to.emit(staking, "Unstake");

        // this will call stakingImpl.withdraw()
        const releasingTS = await staking.getReleasingTimestamp(
            owner.pool.address
        );
        await setNextBlockTimestamp(provider, releasingTS.toNumber() + 1);
        await expect(owner.pool.rebalance()).to.emit(staking, "Withdraw");

        const aliceERC20Balance = await alice.token.balanceOf(alice.address);
        const bobERC20Balance = await bob.token.balanceOf(bob.address);

        await expect(alice.pool.withdraw())
            .to.emit(alice.pool, "Withdraw")
            .withArgs(alice.address, aliceExpectedBalance);

        await expect(bob.pool.withdraw())
            .to.emit(bob.pool, "Withdraw")
            .withArgs(bob.address, bobExpectedBalance);

        expect(await alice.token.balanceOf(alice.address)).to.be.equal(
            aliceERC20Balance.add(aliceExpectedBalance)
        );
        expect(await bob.token.balanceOf(bob.address)).to.be.equal(
            bobERC20Balance.add(bobExpectedBalance)
        );
    });
});
