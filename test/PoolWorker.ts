// Copyright 2021 Cartesi Pte. Ltd.

// Licensed under the Apache License, Version 2.0 (the "License"); you may not use
// this file except in compliance with the License. You may obtain a copy of the
// License at http://www.apache.org/licenses/LICENSE-2.0

// Unless required by applicable law or agreed to in writing, software distributed
// under the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR
// CONDITIONS OF ANY KIND, either express or implied. See the License for the
// specific language governing permissions and limitations under the License.

import { expect, use } from "chai";
import { waffle, ethers } from "hardhat";

import { setupPool } from "./utils";
const { solidity } = waffle;

use(solidity);
const STAKE_LOCK = 60;

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

    it("should fail to hire if not owner", async () => {
        const { node_worker } = await setupPool({
            stakeLock: STAKE_LOCK,
            selfHire: false,
        });

        const value = ethers.utils.parseEther("0.001");
        await expect(
            node_worker.pool.hire(node_worker.address, { value })
        ).to.be.revertedWith("Ownable: caller is not the owner");
    });

    it("should hire an external worker", async () => {
        const {
            owner: { pool },
            node_worker,
            contracts: { pos, workerManager },
        } = await setupPool({ stakeLock: STAKE_LOCK, selfHire: false });

        const node_workerBalance = await pool.provider.getBalance(
            node_worker.address
        );

        const value = ethers.utils.parseEther("0.001");

        await expect(pool.hire(node_worker.address, { value }))
            .to.emit(workerManager, "JobOffer")
            .withArgs(node_worker.address, pool.address)
            .to.emit(workerManager, "Authorization")
            .withArgs(pool.address, node_worker.address, pos.address);

        expect(await pool.provider.getBalance(node_worker.address)).to.be.equal(
            node_workerBalance.add(value)
        );

        await expect(node_worker.workerManager.acceptJob())
            .to.emit(workerManager, "JobAccepted")
            .withArgs(node_worker.address, pool.address);

        expect(
            await workerManager.isAuthorized(node_worker.address, pos.address)
        ).to.be.true;
        expect(await workerManager.isRetired(node_worker.address)).to.be.false;
        expect(await workerManager.isAvailable(node_worker.address)).to.be
            .false;
        expect(await workerManager.isPending(node_worker.address)).to.be.false;
        expect(await workerManager.isOwned(node_worker.address)).to.be.true;
        expect(await workerManager.getOwner(node_worker.address)).to.be.equal(
            pool.address
        );
        expect(await workerManager.getUser(node_worker.address)).to.be.equal(
            pool.address
        );
    });

    it("should fail to cancel hire if not owner", async () => {
        const { node_worker } = await setupPool({
            stakeLock: STAKE_LOCK,
            selfHire: false,
        });

        await expect(
            node_worker.pool.cancelHire(node_worker.address)
        ).to.be.revertedWith("Ownable: caller is not the owner");
    });

    it("should cancel hire an external worker", async () => {
        const {
            owner: { pool },
            node_worker,
            contracts: { pos, workerManager },
        } = await setupPool({ stakeLock: STAKE_LOCK });
        const value = ethers.utils.parseEther("0.001");
        await pool.hire(node_worker.address, { value });
        await node_worker.workerManager.acceptJob();

        await expect(pool.cancelHire(node_worker.address))
            .to.emit(workerManager, "JobRejected")
            .withArgs(node_worker.address, pool.address);

        expect(
            await workerManager.isAuthorized(node_worker.address, pos.address)
        ).to.be.false;
        expect(await workerManager.isRetired(node_worker.address)).to.be.true;
        expect(await workerManager.isAvailable(node_worker.address)).to.be
            .false;
        expect(await workerManager.isPending(node_worker.address)).to.be.false;
        expect(await workerManager.isOwned(node_worker.address)).to.be.false;
        expect(await workerManager.getOwner(node_worker.address)).to.be.equal(
            ethers.constants.AddressZero
        );
        expect(await workerManager.getUser(node_worker.address)).to.be.equal(
            pool.address
        );
    });

    it("should fail to retire if not owner", async () => {
        const { node_worker } = await setupPool({
            stakeLock: STAKE_LOCK,
            selfHire: false,
        });

        await expect(
            node_worker.pool.retire(node_worker.address)
        ).to.be.revertedWith("Ownable: caller is not the owner");
    });

    it("should retire an external worker", async () => {
        const {
            owner: { pool },
            node_worker,
            contracts: { pos, workerManager },
        } = await setupPool({ stakeLock: STAKE_LOCK });
        const value = ethers.utils.parseEther("0.001");
        await pool.hire(node_worker.address, { value });
        await node_worker.workerManager.acceptJob();

        await expect(pool.retire(node_worker.address))
            .to.emit(workerManager, "Retired")
            .withArgs(node_worker.address, pool.address);

        expect(
            await workerManager.isAuthorized(node_worker.address, pos.address)
        ).to.be.false;
        expect(await workerManager.isRetired(node_worker.address)).to.be.true;
        expect(await workerManager.isAvailable(node_worker.address)).to.be
            .false;
        expect(await workerManager.isPending(node_worker.address)).to.be.false;
        expect(await workerManager.isOwned(node_worker.address)).to.be.false;
        expect(await workerManager.getOwner(node_worker.address)).to.be.equal(
            ethers.constants.AddressZero
        );
        expect(await workerManager.getUser(node_worker.address)).to.be.equal(
            pool.address
        );
    });
});
