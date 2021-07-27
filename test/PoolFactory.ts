// Copyright 2021 Cartesi Pte. Ltd.

// Licensed under the Apache License, Version 2.0 (the "License"); you may not use
// this file except in compliance with the License. You may obtain a copy of the
// License at http://www.apache.org/licenses/LICENSE-2.0

// Unless required by applicable law or agreed to in writing, software distributed
// under the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR
// CONDITIONS OF ANY KIND, either express or implied. See the License for the
// specific language governing permissions and limitations under the License.

import { expect } from "chai";
import { Signer } from "ethers";
import { deployments, ethers } from "hardhat";
import {
    FlatRateCommission__factory,
    GasTaxCommission__factory,
    StakingPoolFactoryImpl,
    StakingPoolFactoryImpl__factory,
    StakingPoolImpl__factory,
} from "../src/types";

describe("StakingPoolFactory", async () => {
    let deployer: Signer;
    let user: Signer;
    let factory: StakingPoolFactoryImpl;

    beforeEach(async () => {
        await deployments.fixture();
        [deployer, user] = await ethers.getSigners();
        const { StakingPoolFactoryImpl } = await deployments.all();

        // connect to factory
        factory = StakingPoolFactoryImpl__factory.connect(
            StakingPoolFactoryImpl.address,
            deployer
        );
    });

    it("should only allow owner to pause", async () => {
        await expect(factory.connect(user).pause()).to.be.revertedWith(
            "Ownable: caller is not the owner"
        );
    });

    it("should not work with no reference pool set", async () => {
        await expect(factory.createFlatRateCommission(1)).to.be.revertedWith(
            "undefined reference pool"
        );
    });

    it("should not create when paused and create when unpaused", async () => {
        // set reference pool
        const { StakingPoolImpl } = await deployments.all();
        await factory.setReferencePool(StakingPoolImpl.address);

        // factory starts as not paused
        expect(await factory.paused()).to.be.false;

        // unpause should only work if paused
        await expect(factory.unpause()).to.be.revertedWith(
            "Pausable: not paused"
        );

        // pause contract
        await expect(factory.pause()).to.emit(factory, "Paused");
        expect(await factory.paused()).to.be.true;

        // creation must fail
        await expect(factory.createFlatRateCommission(1)).to.be.revertedWith(
            "Pausable: paused"
        );
        await expect(factory.createGasTaxCommission(1)).to.be.revertedWith(
            "Pausable: paused"
        );

        // pause should only work if unpaused
        await expect(factory.pause()).to.be.revertedWith("Pausable: paused");

        // unpause contract
        await expect(factory.unpause()).to.emit(factory, "Unpaused");
        expect(await factory.paused()).to.be.false;
        await expect(
            factory.createFlatRateCommission(1)
        ).to.not.be.revertedWith("Pausable: paused");
    });

    it("should create flat rate pool", async () => {
        // set reference pool
        const { StakingPoolImpl } = await deployments.all();
        await factory.setReferencePool(StakingPoolImpl.address);

        const rate = 10;
        const tx = await factory.createFlatRateCommission(rate, {
            value: ethers.utils.parseEther("0.001"),
        });
        await expect(tx).to.emit(factory, "NewFlatRateCommissionStakingPool");
        const receipt = await tx.wait(1);
        const event = receipt.events?.find(
            (e) => e.event == "NewFlatRateCommissionStakingPool"
        );
        const poolAddress = event?.args?.pool;
        const feeAddress = event?.args?.fee;

        // connect to pool contract and check if fee is correct
        const pool = StakingPoolImpl__factory.connect(poolAddress, deployer);
        expect(await pool.fee()).to.equal(feeAddress);

        // connect to fee contract and check rate value
        const fee = FlatRateCommission__factory.connect(feeAddress, deployer);
        expect(await fee.rate()).to.equal(rate);

        // after deployment the factory must redirect the payable value back to the user
        expect(
            await deployer.provider?.getBalance(factory.address)
        ).to.be.equal(0);
    });

    it("should create gas tax pool", async () => {
        // set reference pool
        const { StakingPoolImpl } = await deployments.all();
        await factory.setReferencePool(StakingPoolImpl.address);

        const gas = 100000;
        const tx = await factory.createGasTaxCommission(gas, {
            value: ethers.utils.parseEther("0.001"),
        });
        await expect(tx).to.emit(factory, "NewGasTaxCommissionStakingPool");
        const receipt = await tx.wait(1);
        const event = receipt.events?.find(
            (e) => e.event == "NewGasTaxCommissionStakingPool"
        );
        const poolAddress = event?.args?.pool;
        const feeAddress = event?.args?.fee;

        // connect to pool contract and check if fee is correct
        const pool = StakingPoolImpl__factory.connect(poolAddress, deployer);
        expect(await pool.fee()).to.equal(feeAddress);

        // connect to fee contract and check rate value
        const fee = GasTaxCommission__factory.connect(feeAddress, deployer);
        expect(await fee.gas()).to.equal(gas);

        // after deployment the factory must redirect the payable value back to the user
        expect(
            await deployer.provider?.getBalance(factory.address)
        ).to.be.equal(0);
    });

    it("should only allow owner to modify pool reference", async () => {
        const newPool = "0x58EEB5D44Dc41965AB0a9E563536175C8dc5C3B3"; // any other address
        await expect(
            factory.connect(user).setReferencePool(newPool)
        ).to.be.revertedWith("Ownable: caller is not the owner");
    });

    it("should allow owner to modify pool reference", async () => {
        // set reference pool
        const { StakingPoolImpl } = await deployments.all();
        await expect(factory.setReferencePool(StakingPoolImpl.address))
            .to.emit(factory, "ReferencePoolChanged")
            .withArgs(StakingPoolImpl.address);
    });
});
