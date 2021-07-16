import { expect, use } from "chai";
import { waffle } from "hardhat";

import { setNextBlockTimestamp, setupPool, parseCTSI } from "./utils";
const { solidity } = waffle;

use(solidity);
const MINUTE = 60; // seconds in a minute
const HOUR = 60 * MINUTE; // seconds in an hour
const STAKE_LOCK = 60; // seconds

describe("StakingPoolProducer", async () => {
    beforeEach(async () => {});

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
        } = await setupPool({});
        const stake = parseCTSI("1000");
        await alice.token.approve(alice.pool.address, stake);
        await bob.token.approve(bob.pool.address, stake.mul(9));

        await alice.pool.stake(stake);
        await bob.pool.stake(stake.mul(9));

        // stake to staking
        await owner.pool.rebalance();
        await owner.pool.produceBlock(0);

        const aliceBalance = await alice.pool.userBalance(alice.address);
        const bobBalance = await bob.pool.userBalance(bob.address);

        expect(aliceBalance.shares.mul(9)).to.be.equal(bobBalance.shares);

        const ts = Date.now();
        await setNextBlockTimestamp(alice.pool.provider, ts + STAKE_LOCK + 1);

        const remainingReward = reward.sub(commission);
        const aliceExpectedBalance = stake.add(remainingReward.div(10));
        const bobExpectedBalance = stake
            .mul(9)
            .add(remainingReward.mul(9).div(10));

        await expect(alice.pool.unstake(aliceBalance.shares))
            .to.emit(alice.pool, "Unstake")
            .withArgs(alice.address, aliceExpectedBalance, aliceBalance.shares);

        await expect(bob.pool.unstake(bobBalance.shares))
            .to.emit(bob.pool, "Unstake")
            .withArgs(bob.address, bobExpectedBalance, bobBalance.shares);
    });
});
