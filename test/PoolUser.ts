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

import {
    advanceTime,
    setNextBlockTimestamp,
    setupPool,
    parseCTSI,
} from "./utils";
const { solidity } = waffle;

use(solidity);
const MINUTE = 60; // seconds in a minute
const HOUR = 60 * MINUTE; // seconds in an hour
const STAKE_LOCK = 60; // seconds
const timeToStake = 2 * MINUTE;

describe("StakingPoolUser", async () => {
    beforeEach(async () => {});

    it("should not allow unstake of zero shares", async () => {
        const { alice } = await setupPool({ stakeLock: STAKE_LOCK });
        await expect(alice.pool.unstake(0)).to.revertedWith(
            "StakingPoolUserImpl: invalid amount of shares"
        );
    });

    it("should not allow unstake with no shares", async () => {
        const { alice } = await setupPool({ stakeLock: STAKE_LOCK });
        await expect(alice.pool.unstake(1)).to.revertedWith(
            "StakingPoolUserImpl: insufficient shares"
        );
    });

    it("should not allow stake zero tokens", async () => {
        const { alice } = await setupPool({ stakeLock: STAKE_LOCK });
        await expect(alice.pool.stake(0)).to.revertedWith(
            "StakingPoolUserImpl: amount must be greater than 0"
        );
    });

    it("should not deposit what user don't have", async () => {
        const { alice } = await setupPool({ stakeLock: STAKE_LOCK });
        await expect(
            alice.pool.deposit(parseCTSI("100000"))
        ).to.be.revertedWith("ERC20: transfer amount exceeds balance");
    });

    it("should not deposit what user didn't allow", async () => {
        const { alice } = await setupPool({ stakeLock: STAKE_LOCK });
        await expect(alice.pool.deposit(parseCTSI("1000"))).to.be.revertedWith(
            "ERC20: transfer amount exceeds allowance"
        );
    });

    it("should successfully deposit", async () => {
        const {
            alice,
            owner: {
                pool: { provider },
            },
        } = await setupPool({ stakeLock: STAKE_LOCK });
        const stake = parseCTSI("1000");
        await alice.token.approve(alice.pool.address, stake);
        const ts = Date.now();
        await setNextBlockTimestamp(provider, ts);

        await expect(alice.pool.deposit(stake))
            .to.emit(alice.pool, "Deposit")
            .withArgs(alice.address, stake, ts + STAKE_LOCK);

        // at start shares = amount
        expect(await alice.pool.shares()).to.equal(0);
        expect(await alice.pool.amount()).to.equal(0);
        const balance = await alice.pool.userBalance(alice.address);
        expect(balance.shares).to.equal(0);
        expect(balance.depositTimestamp).to.equal(ts);
        expect(balance.balance).to.equal(stake);
    });

    it("should not stake what user don't have", async () => {
        const { alice } = await setupPool({ stakeLock: STAKE_LOCK });
        await expect(alice.pool.stake(parseCTSI("100000"))).to.be.revertedWith(
            "StakingPoolUserImpl: not enough tokens available for staking"
        );
    });

    it("should successfully stake", async () => {
        const {
            alice,
            owner: {
                pool: { provider },
            },
        } = await setupPool({ stakeLock: STAKE_LOCK });
        const stake = parseCTSI("1000");
        await alice.token.approve(alice.pool.address, stake);
        const ts = Date.now();
        await setNextBlockTimestamp(provider, ts);
        await alice.pool.deposit(stake);

        await setNextBlockTimestamp(alice.pool.provider, ts + STAKE_LOCK + 1);

        await expect(alice.pool.stake(stake))
            .to.emit(alice.pool, "Stake")
            .withArgs(alice.address, stake, stake);

        // at start shares = amount
        expect(await alice.pool.shares()).to.equal(stake);
        expect(await alice.pool.amount()).to.equal(stake);
        const balance = await alice.pool.userBalance(alice.address);
        expect(balance.shares).to.equal(stake);
        expect(balance.depositTimestamp).to.equal(ts);
        expect(balance.balance).to.equal(0);
    });

    it("should not allow to receive zero shares", async () => {
        const { alice, bob, owner } = await setupPool({
            stakeLock: STAKE_LOCK,
        });
        const provider = owner.pool.provider;

        // stake 1e-18 tokens, earn 1e-18 shares
        await alice.token.approve(alice.pool.address, 1);
        const ts = Date.now();
        await setNextBlockTimestamp(provider, ts);
        await alice.pool.deposit(1);

        let nextTS = ts + STAKE_LOCK + 1;
        await setNextBlockTimestamp(provider, nextTS);
        await alice.pool.stake(1);
        expect((await alice.pool.userBalance(alice.address)).shares).to.equal(
            1
        );

        // stake to staking
        await owner.pool.rebalance();

        // advance time to mature stake
        nextTS += timeToStake;
        await setNextBlockTimestamp(provider, nextTS);

        // produce a block
        await owner.pool.produceBlock(0);

        // bob tries to stake same as alice, but it's not enough to emit a single share
        nextTS += 10;
        await setNextBlockTimestamp(provider, nextTS);
        await bob.token.approve(bob.pool.address, 1);
        await bob.pool.deposit(1);
        await setNextBlockTimestamp(provider, nextTS + STAKE_LOCK + 1);
        await expect(bob.pool.stake(1)).to.revertedWith(
            "StakingPoolUserImpl: stake not enough to emit 1 share"
        );
    });

    it("should lock user deposit", async () => {
        const {
            alice,
            owner: {
                pool: { provider },
            },
        } = await setupPool({ stakeLock: STAKE_LOCK });
        const stake = parseCTSI("1000");
        await alice.token.approve(alice.pool.address, stake);
        await alice.pool.deposit(stake);

        await expect(alice.pool.stake(stake)).to.be.revertedWith(
            "StakingPoolUserImpl: not enough time has passed since last deposit"
        );
    });

    it("should successfully unstake", async () => {
        const {
            alice,
            owner: {
                pool: { provider },
            },
        } = await setupPool({ stakeLock: STAKE_LOCK });
        const stake = parseCTSI("1000");
        const unstake = stake.div(4);
        await alice.token.approve(alice.pool.address, stake);
        const ts = Date.now();
        await setNextBlockTimestamp(provider, ts);
        await alice.pool.deposit(stake);

        let nextTS = ts + STAKE_LOCK + 1;
        await setNextBlockTimestamp(provider, nextTS);
        await alice.pool.stake(stake);

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
        expect(balance.balance).to.equal(unstake);

        // required liquidity should increase
        expect(await alice.pool.requiredLiquidity()).to.equal(unstake);
    });

    it("should not withdraw with no user balance", async () => {
        const { alice } = await setupPool({ stakeLock: STAKE_LOCK });
        const stake = parseCTSI("1000");
        await expect(alice.pool.withdraw(stake)).to.be.revertedWith(
            "StakingPoolUserImpl: no balance to withdraw"
        );
    });

    it("should withdraw right after unstake", async () => {
        const {
            alice,
            owner: {
                pool: { provider },
            },
        } = await setupPool({ stakeLock: STAKE_LOCK });
        const stake = parseCTSI("1000");
        await alice.token.approve(alice.pool.address, stake);
        const ts = Date.now();
        await setNextBlockTimestamp(provider, ts);
        await alice.pool.deposit(stake);

        // stake
        const nextTS = ts + STAKE_LOCK + 1;
        await setNextBlockTimestamp(alice.pool.provider, nextTS);
        await alice.pool.stake(stake);

        await alice.pool.unstake(stake);

        // unstake request liquidity
        expect(await alice.pool.requiredLiquidity()).to.equal(stake);
        expect(await alice.pool.getWithdrawBalance()).to.equal(stake);
        await expect(alice.pool.withdraw(stake))
            .to.emit(alice.pool, "Withdraw")
            .withArgs(alice.address, stake);

        const balance = await alice.pool.userBalance(alice.address);
        expect(balance.balance).to.equal(0);

        // decrease liquidity
        expect(await alice.pool.requiredLiquidity()).to.equal(0);
    });

    it("should not withdraw with no pool balance", async () => {
        const {
            alice,
            owner: {
                pool: { provider },
            },
        } = await setupPool({ stakeLock: STAKE_LOCK });
        const stake = parseCTSI("1000");
        const unstake = stake.div(4);
        await alice.token.approve(alice.pool.address, stake);
        const ts = Date.now();
        await setNextBlockTimestamp(provider, ts);
        await alice.pool.deposit(stake);

        // stake
        await setNextBlockTimestamp(provider, ts + STAKE_LOCK + 1);
        await alice.pool.stake(stake);

        // stake to staking
        await alice.pool.rebalance();

        // unstake 1/4
        await alice.pool.unstake(unstake);

        // should not have balance
        expect(await alice.pool.getWithdrawBalance()).to.equal(0);

        await expect(alice.pool.withdraw(unstake)).to.be.revertedWith(
            "ERC20: transfer amount exceeds balance"
        );
    });
});
