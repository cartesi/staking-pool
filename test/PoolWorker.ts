// Copyright 2021 Cartesi Pte. Ltd.

// Licensed under the Apache License, Version 2.0 (the "License"); you may not use
// this file except in compliance with the License. You may obtain a copy of the
// License at http://www.apache.org/licenses/LICENSE-2.0

// Unless required by applicable law or agreed to in writing, software distributed
// under the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR
// CONDITIONS OF ANY KIND, either express or implied. See the License for the
// specific language governing permissions and limitations under the License.

import { expect, use } from "chai";
import { waffle, deployments, ethers } from "hardhat";

import { setNextBlockTimestamp, setupPool, parseCTSI } from "./utils";
const { solidity } = waffle;

use(solidity);
const STAKE_LOCK = 60; // seconds WorkerManagerAuthManagerImpl

describe("StakingPoolWorker", async () => {
    it("should have correct defaults", async () => {
        const {
            owner: { pool },
            contracts: { pos, workerManager },
        } = await setupPool({ stakeLock: STAKE_LOCK, selfHire: false });

        expect(await pool.provider.getBalance(pool.address)).to.be.equal(
            ethers.BigNumber.from(0)
        );

        expect(await workerManager.isAuthorized(pool.address, pos.address)).to
            .be.false;
        expect(await workerManager.isRetired(pool.address)).to.be.false;
        expect(await workerManager.isAvailable(pool.address)).to.be.true;
        expect(await workerManager.isPending(pool.address)).to.be.false;
        expect(await workerManager.isOwned(pool.address)).to.be.false;
        expect(await workerManager.getOwner(pool.address)).to.be.equal(
            ethers.constants.AddressZero
        );
        expect(await workerManager.getUser(pool.address)).to.be.equal(
            ethers.constants.AddressZero
        );
    });

    it("should selfhire and change defaults", async () => {
        const {
            owner: { pool },
            contracts: { pos, workerManager },
        } = await setupPool({ stakeLock: STAKE_LOCK, selfHire: false });
        const value = ethers.utils.parseEther("0.001");

        await expect(pool.selfhire({ value }))
            .to.emit(workerManager, "JobOffer")
            .withArgs(pool.address, pool.address)
            .to.emit(workerManager, "Authorization")
            .withArgs(pool.address, pool.address, pos.address)
            .to.emit(workerManager, "JobAccepted")
            .withArgs(pool.address, pool.address);

        expect(await pool.provider.getBalance(pool.address)).to.be.equal(
            ethers.BigNumber.from(0)
        );

        expect(await workerManager.isAuthorized(pool.address, pos.address)).to
            .be.true;
        expect(await workerManager.isRetired(pool.address)).to.be.false;
        expect(await workerManager.isAvailable(pool.address)).to.be.false;
        expect(await workerManager.isPending(pool.address)).to.be.false;
        expect(await workerManager.isOwned(pool.address)).to.be.true;
        expect(await workerManager.getOwner(pool.address)).to.be.equal(
            pool.address
        );
        expect(await workerManager.getUser(pool.address)).to.be.equal(
            pool.address
        );
    });

    it("should hire an external worker", async () => {
        const {
            owner: { pool },
            alice,
            contracts: { pos, workerManager },
        } = await setupPool({ stakeLock: STAKE_LOCK, selfHire: false });

        const aliceBalance = await pool.provider.getBalance(alice.address);

        const value = ethers.utils.parseEther("0.001");

        await expect(pool.hire(alice.address, { value }))
            .to.emit(workerManager, "JobOffer")
            .withArgs(alice.address, pool.address)
            .to.emit(workerManager, "Authorization")
            .withArgs(pool.address, alice.address, pos.address);

        expect(await pool.provider.getBalance(alice.address)).to.be.equal(
            aliceBalance.add(value)
        );

        await expect(alice.workerManager.acceptJob())
            .to.emit(workerManager, "JobAccepted")
            .withArgs(alice.address, pool.address);

        expect(await workerManager.isAuthorized(alice.address, pos.address)).to
            .be.true;
        expect(await workerManager.isRetired(alice.address)).to.be.false;
        expect(await workerManager.isAvailable(alice.address)).to.be.false;
        expect(await workerManager.isPending(alice.address)).to.be.false;
        expect(await workerManager.isOwned(alice.address)).to.be.true;
        expect(await workerManager.getOwner(alice.address)).to.be.equal(
            pool.address
        );
        expect(await workerManager.getUser(alice.address)).to.be.equal(
            pool.address
        );
    });

    it("should cancel hire an external worker", async () => {
        const {
            owner: { pool },
            alice,
            contracts: { pos, workerManager },
        } = await setupPool({ stakeLock: STAKE_LOCK });
        const value = ethers.utils.parseEther("0.001");
        await pool.hire(alice.address, { value });
        await alice.workerManager.acceptJob();

        await expect(pool.cancelHire(alice.address))
            .to.emit(workerManager, "JobRejected")
            .withArgs(alice.address, pool.address);

        expect(await workerManager.isAuthorized(alice.address, pos.address)).to
            .be.false;
        expect(await workerManager.isRetired(alice.address)).to.be.true;
        expect(await workerManager.isAvailable(alice.address)).to.be.false;
        expect(await workerManager.isPending(alice.address)).to.be.false;
        expect(await workerManager.isOwned(alice.address)).to.be.false;
        expect(await workerManager.getOwner(alice.address)).to.be.equal(
            ethers.constants.AddressZero
        );
        expect(await workerManager.getUser(alice.address)).to.be.equal(
            pool.address
        );
    });

    it("should retire an external worker", async () => {
        const {
            owner: { pool },
            alice,
            contracts: { pos, workerManager },
        } = await setupPool({ stakeLock: STAKE_LOCK });
        const value = ethers.utils.parseEther("0.001");
        await pool.hire(alice.address, { value });
        await alice.workerManager.acceptJob();

        await expect(pool.retire(alice.address))
            .to.emit(workerManager, "Retired")
            .withArgs(alice.address, pool.address);

        expect(await workerManager.isAuthorized(alice.address, pos.address)).to
            .be.false;
        expect(await workerManager.isRetired(alice.address)).to.be.true;
        expect(await workerManager.isAvailable(alice.address)).to.be.false;
        expect(await workerManager.isPending(alice.address)).to.be.false;
        expect(await workerManager.isOwned(alice.address)).to.be.false;
        expect(await workerManager.getOwner(alice.address)).to.be.equal(
            ethers.constants.AddressZero
        );
        expect(await workerManager.getUser(alice.address)).to.be.equal(
            pool.address
        );
    });
});
