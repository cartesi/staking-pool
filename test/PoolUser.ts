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

import { setNextBlockTimestamp } from "./utils";
const { solidity, deployMockContract } = waffle;

use(solidity);
const STAKE_LOCK = 60; // seconds

const parseCTSI = (value: string) => ethers.utils.parseUnits(value, 18);

describe("StakingPoolUser", async () => {
    beforeEach(async () => {});

    const setupPool = deployments.createFixture(
        async ({ deployments, ethers }, options) => {
            // start with a fresh deployment
            await deployments.fixture();

            const [deployer, alice, bob] = await ethers.getSigners();
            const { CartesiToken, StakingPoolImpl } = await deployments.all();

            // setup fee mock contract
            const reward = 200;
            const commission = reward * 0.1; // 10%
            const commissionArtifact = await deployments.getArtifact(
                "FlatRateCommission"
            );
            const fee = await deployMockContract(
                deployer,
                commissionArtifact.abi
            );
            await fee.mock.getCommission.returns(commission);

            // setup tolen distribution
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
            await pool.initialize(deployer.address, fee.address, STAKE_LOCK);
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
        await (alice.pool.provider as JsonRpcProvider).send(
            "evm_setNextBlockTimestamp",
            [ts]
        );

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

    it("should lock stake", async () => {
        const { alice } = await setupPool();
        const stake = parseCTSI("1000");
        await alice.token.approve(alice.pool.address, stake);

        const ts = Date.now();
        setNextBlockTimestamp(alice.pool.provider as JsonRpcProvider, ts);
        await alice.pool.stake(stake);

        // only 10 seconds after stake
        setNextBlockTimestamp(alice.pool.provider as JsonRpcProvider, ts + 10);

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
        setNextBlockTimestamp(alice.pool.provider as JsonRpcProvider, ts);
        await alice.pool.stake(stake);

        // only 10 seconds after stake
        setNextBlockTimestamp(alice.pool.provider as JsonRpcProvider, ts + 61);

        await expect(alice.pool.unstake(unstake))
            .to.emit(alice.pool, "Unstake")
            .withArgs(alice.address, unstake, unstake);

        expect(await alice.pool.shares()).to.equal(stake.sub(unstake));
        expect(await alice.pool.amount()).to.equal(stake.sub(unstake));
        const balance = await alice.pool.userBalance(alice.address);
        expect(balance.shares).to.equal(stake.sub(unstake));
        expect(balance.released).to.equal(unstake);
    });
});