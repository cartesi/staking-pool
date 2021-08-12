// Copyright 2021 Cartesi Pte. Ltd.

// Licensed under the Apache License, Version 2.0 (the "License"); you may not use
// this file except in compliance with the License. You may obtain a copy of the
// License at http://www.apache.org/licenses/LICENSE-2.0

// Unless required by applicable law or agreed to in writing, software distributed
// under the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR
// CONDITIONS OF ANY KIND, either express or implied. See the License for the
// specific language governing permissions and limitations under the License.

import { expect, use } from "chai";
import { ethers, waffle } from "hardhat";

import {
    advanceBlock,
    setNextBlockTimestamp,
    setupPool,
    parseCTSI,
} from "./utils";
const { solidity } = waffle;

use(solidity);
const MINUTE = 60; // seconds in a minute
const HOUR = 60 * MINUTE; // seconds in an hour
const STAKE_LOCK = 30; // 30 seconds
const timeToStake = 2 * MINUTE;
const timeToRelease = 2 * MINUTE;

describe("StakingPoolStaking", async () => {
    it("should have right initialization", async () => {
        const {
            owner: { pool, token },
            contracts: { staking },
        } = await setupPool({ stakeLock: STAKE_LOCK });

        expect(await token.balanceOf(pool.address)).to.be.equal(0);
        expect(
            await token.allowance(pool.address, staking.address)
        ).to.be.equal(ethers.constants.MaxUint256);

        const amounts = await pool.amounts();
        expect(amounts.stake.toNumber()).to.be.equal(0);
        expect(amounts.unstake.toNumber()).to.be.equal(0);
        expect(amounts.withdraw.toNumber()).to.be.equal(0);

        const tx = await pool.rebalance();
        const receipt = await tx.wait();
        expect(receipt.events?.length).to.be.equal(0);
    });

    it("should stake any outstanding balance", async () => {
        const {
            alice,
            owner: { pool },
            contracts: { staking },
        } = await setupPool({ stakeLock: STAKE_LOCK });
        const balance = parseCTSI("100");
        await alice.token.transfer(pool.address, balance);

        const amounts = await pool.amounts();
        expect(amounts.stake).to.be.equal(balance);
        expect(amounts.unstake.toNumber()).to.be.equal(0);
        expect(amounts.withdraw.toNumber()).to.be.equal(0);

        // stake to staking
        const ts = Date.now();
        await setNextBlockTimestamp(pool.provider, ts);

        await expect(pool.rebalance())
            .to.emit(staking, "Stake")
            .withArgs(pool.address, balance, ts + timeToRelease);
    });

    it("should not stake when a user deposits", async () => {
        const {
            alice,
            owner: { pool },
            contracts: { staking },
        } = await setupPool({ stakeLock: STAKE_LOCK });
        const provider = pool.provider;
        const stake = parseCTSI("1000");
        await alice.token.approve(pool.address, stake);
        await alice.pool.deposit(stake);

        const amounts = await pool.amounts();
        expect(amounts.stake.toNumber()).to.be.equal(0);
        expect(amounts.unstake.toNumber()).to.be.equal(0);
        expect(amounts.withdraw.toNumber()).to.be.equal(0);
    });

    it("should wait when a previous stake is maturing", async () => {
        const {
            alice,
            owner: { pool },
            contracts: { staking },
        } = await setupPool({ stakeLock: STAKE_LOCK });

        const ts = Date.now();
        const stake = parseCTSI("1000");
        await alice.token.approve(pool.address, stake.mul(2));
        await alice.pool.deposit(stake.mul(2));

        await setNextBlockTimestamp(pool.provider, ts + STAKE_LOCK + 1);
        await alice.pool.stake(stake);
        let amounts = await pool.amounts();
        await pool.rebalance();

        // second stake
        await setNextBlockTimestamp(pool.provider, ts + STAKE_LOCK * 2 + 1);
        await alice.pool.stake(stake);

        amounts = await pool.amounts();
        expect(amounts.stake.toNumber()).to.be.equal(0);
        expect(amounts.unstake.toNumber()).to.be.equal(0);
        expect(amounts.withdraw.toNumber()).to.be.equal(0);

        const tx = await pool.rebalance();
        const receipt = await tx.wait();
        expect(receipt.events?.length).to.be.equal(0);
    });

    it("should unstake on user request", async () => {
        const {
            alice,
            owner: { pool },
            contracts: { staking },
        } = await setupPool({ stakeLock: STAKE_LOCK });

        const stake = parseCTSI("1000");
        await alice.token.approve(pool.address, stake);
        const ts = Date.now();
        await setNextBlockTimestamp(pool.provider, ts);
        await alice.pool.deposit(stake);

        // now we advance time so we unlock the stake() action
        let nextTS = ts + STAKE_LOCK + 1;
        await setNextBlockTimestamp(pool.provider, nextTS);

        await alice.pool.stake(stake);
        await pool.rebalance();

        const { shares } = await alice.pool.userBalance(alice.address);
        await alice.pool.unstake(shares);

        const amounts = await pool.amounts();
        expect(amounts.stake.toNumber()).to.be.equal(0);
        expect(amounts.unstake).to.be.equal(stake);
        expect(amounts.withdraw.toNumber()).to.be.equal(0);

        nextTS += 10;
        await setNextBlockTimestamp(pool.provider, nextTS);
        await expect(pool.rebalance())
            .to.emit(staking, "Unstake")
            .withArgs(pool.address, stake, nextTS + timeToRelease);
    });

    it("should wait when a previous unstake is releasing", async () => {
        const {
            alice,
            owner: { pool },
            contracts: { staking },
        } = await setupPool({ stakeLock: STAKE_LOCK });

        const stake = parseCTSI("1000");
        await alice.token.approve(pool.address, stake);
        const ts = Date.now();
        await setNextBlockTimestamp(pool.provider, ts);
        await alice.pool.deposit(stake);
        // now we advance time so we unlock the stake() action
        let nextTS = ts + STAKE_LOCK + 1;
        await setNextBlockTimestamp(pool.provider, nextTS);

        await alice.pool.stake(stake);
        await pool.rebalance();

        const { shares } = await alice.pool.userBalance(alice.address);
        await alice.pool.unstake(shares.div(2));

        nextTS += 10;
        await setNextBlockTimestamp(pool.provider, nextTS);
        await pool.rebalance();

        // second request to unstake
        await alice.pool.unstake(shares.div(2));

        const amounts = await pool.amounts();
        expect(amounts.stake.toNumber()).to.be.equal(0);
        expect(amounts.unstake.toNumber()).to.be.equal(0);
        expect(amounts.withdraw.toNumber()).to.be.equal(0);

        const tx = await pool.rebalance();
        const receipt = await tx.wait();
        expect(receipt.events?.length).to.be.equal(0);
    });

    it("should withdraw on user request", async () => {
        const {
            alice,
            owner: { pool },
            contracts: { staking },
        } = await setupPool({ stakeLock: STAKE_LOCK });

        const stake = parseCTSI("1000");
        await alice.token.approve(pool.address, stake);
        const ts = Date.now();
        await setNextBlockTimestamp(pool.provider, ts);
        await alice.pool.deposit(stake);

        // now we advance time so we unlock the stake() action
        let nextTS = ts + STAKE_LOCK + 1;
        await setNextBlockTimestamp(pool.provider, nextTS);
        await alice.pool.stake(stake);

        await pool.rebalance();
        nextTS += timeToStake + 1;
        await setNextBlockTimestamp(pool.provider, nextTS);

        const { shares } = await alice.pool.userBalance(alice.address);
        await alice.pool.unstake(shares);
        await pool.rebalance();

        nextTS += timeToRelease + 2;
        await setNextBlockTimestamp(pool.provider, nextTS);
        await advanceBlock(pool.provider);

        let amounts = await pool.amounts();
        expect(amounts.stake.toNumber()).to.be.equal(0);
        expect(amounts.unstake.toNumber()).to.be.equal(0);
        expect(amounts.withdraw).to.be.equal(stake);

        await expect(pool.rebalance())
            .to.emit(staking, "Withdraw")
            .withArgs(pool.address, stake);

        amounts = await pool.amounts();
        expect(amounts.stake.toNumber()).to.be.equal(0);
        expect(amounts.unstake.toNumber()).to.be.equal(0);
        expect(amounts.withdraw.toNumber()).to.be.equal(0);
    });

    it("should wait releasing time to withdraw", async () => {
        const {
            alice,
            owner: { pool },
            contracts: { staking },
        } = await setupPool({ stakeLock: STAKE_LOCK });

        const stake = parseCTSI("1000");
        await alice.token.approve(pool.address, stake);
        const ts = Date.now();
        await setNextBlockTimestamp(pool.provider, ts);
        await alice.pool.deposit(stake);

        let nextTS = ts + STAKE_LOCK + 1;
        await setNextBlockTimestamp(pool.provider, nextTS);
        await alice.pool.stake(stake);
        await pool.rebalance();
        nextTS += timeToStake + 10;
        await setNextBlockTimestamp(pool.provider, nextTS);

        const { shares } = await alice.pool.userBalance(alice.address);
        await alice.pool.unstake(shares);
        await pool.rebalance();

        nextTS += 2;
        await setNextBlockTimestamp(pool.provider, nextTS);
        await advanceBlock(pool.provider);

        let amounts = await pool.amounts();
        expect(amounts.stake.toNumber()).to.be.equal(0);
        expect(amounts.unstake.toNumber()).to.be.equal(0);
        expect(amounts.withdraw.toNumber()).to.be.equal(0);

        const tx = await pool.rebalance();
        const receipt = await tx.wait();
        expect(receipt.events?.length).to.be.equal(0);
    });
});
