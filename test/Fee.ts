// Copyright 2021 Cartesi Pte. Ltd.

// Licensed under the Apache License, Version 2.0 (the "License"); you may not use
// this file except in compliance with the License. You may obtain a copy of the
// License at http://www.apache.org/licenses/LICENSE-2.0

// Unless required by applicable law or agreed to in writing, software distributed
// under the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR
// CONDITIONS OF ANY KIND, either express or implied. See the License for the
// specific language governing permissions and limitations under the License.

import { expect, use } from "chai";
import { ethers, waffle, deployments } from "hardhat";
import { BigNumberish, Signer } from "ethers";

import {
    FlatRateCommission,
    FlatRateCommission__factory,
    GasTaxCommission,
    GasTaxCommission__factory,
    ChainlinkPriceOracle__factory,
    ChainlinkGasOracle__factory,
} from "../src/types";

import { setNextBlockTimestamp } from "./utils";

const { solidity, deployMockContract } = waffle;

use(solidity);

const MINUTE = 60; // seconds in a minute
const HOUR = 60 * MINUTE; // seconds in an hour
const DAY = 24 * HOUR; // seconds in a day

const FeeRaiseTimeout = 7 * DAY;
const maxFeeRaise = 500;
const maxGasRaise = 20000;

describe("Commission Tests", async () => {
    beforeEach(async () => {
        await deployments.fixture();
    });

    describe("FlatRateCommission", async () => {
        const commission = 1000; // 10%
        let signer: Signer;
        let secSigner: Signer;
        let signerAddress: string;
        let contract: FlatRateCommission;

        const deploy = async (
            commission: number
        ): Promise<FlatRateCommission> => {
            const [signer] = await ethers.getSigners();
            const factory = new FlatRateCommission__factory(signer);
            return factory.deploy(commission, FeeRaiseTimeout, maxFeeRaise);
        };

        beforeEach(async () => {
            [signer, secSigner] = await ethers.getSigners();
            signerAddress = await signer.getAddress();
            contract = await deploy(commission);
            // XXX: how to use expect().to.emit(contract, event) when a constructor is emitting?
        });

        it("should calculate 10% correctly on getCommission", async () => {
            const value = 200;
            expect(await contract.getCommission(0, value)).to.equal(
                value * 0.1
            );
        });

        it("should reduce the commission correctly", async () => {
            const newCommission = 500;
            await expect(contract.setRate(newCommission))
                .to.emit(contract, "FlatRateChanged")
                .withArgs(newCommission, 0);
            expect(await contract.rate()).to.be.equal(newCommission);
        });

        it("should fail to reduce commission if not called by owner", async () => {
            const newCommission = 500;
            const tx = contract.connect(secSigner).setRate(newCommission);
            await expect(tx).to.be.revertedWith(
                "Ownable: caller is not the owner"
            );
        });

        it("should add timeout if commission new value is equal or higher", async () => {
            const ts = Date.now();
            await setNextBlockTimestamp(contract.provider, ts);
            await expect(contract.setRate(commission))
                .to.emit(contract, "FlatRateChanged")
                .withArgs(commission, 0);

            const nextTS = ts + FeeRaiseTimeout + 1;
            let newCommission = commission + 1;
            await setNextBlockTimestamp(contract.provider, nextTS);
            await expect(contract.setRate(newCommission))
                .to.emit(contract, "FlatRateChanged")
                .withArgs(newCommission, nextTS + FeeRaiseTimeout);
        });

        it("should fail to raise commission if timeout is not over", async () => {
            const ts = Date.now();
            await setNextBlockTimestamp(contract.provider, ts);

            let newCommission = commission + 1;
            await expect(contract.setRate(newCommission))
                .to.emit(contract, "FlatRateChanged")
                .withArgs(newCommission, ts + FeeRaiseTimeout);
            await expect(
                contract.setRate(newCommission + 1)
            ).to.be.revertedWith(
                "FlatRateCommission: the fee raise timeout is not expired yet"
            );
        });

        it("should fail to raise commission if over max", async () => {
            const ts = Date.now();
            await setNextBlockTimestamp(contract.provider, ts);

            let newCommission = commission + maxFeeRaise + 1;
            await expect(contract.setRate(newCommission)).to.revertedWith(
                "FlatRateCommission: the fee raise is over the maximum allowed percentage value"
            );
        });
    });

    describe("GasTaxCommission", async () => {
        const deploy = async (
            gas: BigNumberish,
            gasPrice: BigNumberish,
            ctsiPrice: BigNumberish
        ): Promise<GasTaxCommission> => {
            const [signer] = await ethers.getSigners();

            // build a chainlink oracle mock returning the specified gas price
            const gasOracle = await deployMockContract(
                signer,
                ChainlinkGasOracle__factory.abi
            );
            gasOracle.mock.getGasPrice.returns(gasPrice);

            const priceOracle = await deployMockContract(
                signer,
                ChainlinkPriceOracle__factory.abi
            );
            priceOracle.mock.getPrice.returns(ctsiPrice);

            // deploy the contract
            const factory = new GasTaxCommission__factory(signer);
            return factory.deploy(
                gasOracle.address,
                priceOracle.address,
                gas,
                FeeRaiseTimeout,
                maxGasRaise
            );
        };

        it("should be zero if charging zero gas", async () => {
            const gasPrice = ethers.utils.parseUnits("100", "gwei");
            const ctsiPrice = ethers.utils.parseEther("0.001");
            const contract = await deploy(0, gasPrice, ctsiPrice);
            expect(await contract.getCommission(0, 100)).to.equal(0);
        });

        it("should be zero if CTSI price is zero", async () => {
            const gasPrice = ethers.utils.parseUnits("100", "gwei");
            const ctsiPrice = ethers.utils.parseEther("0");
            const contract = await deploy(1000000, gasPrice, ctsiPrice);
            expect(await contract.getCommission(0, 100)).to.equal(0);
        });

        it("should be zero if gas price is zero", async () => {
            const gasPrice = ethers.utils.parseUnits("0", "gwei");
            const ctsiPrice = ethers.utils.parseEther("0.001");
            const contract = await deploy(1000000, gasPrice, ctsiPrice);
            expect(await contract.getCommission(0, 100)).to.equal(0);
        });

        it("should calculate 100% fee", async () => {
            const reward = ethers.utils.parseUnits("10", 18); // 10^19 = 10 CTSI
            const gas = 100000; // 10^5
            const gasPrice = ethers.utils.parseUnits("100", "gwei"); // 10^11
            const ctsiPrice = ethers.utils.parseEther("0.001"); // 10^15

            // gasFee = gasPrice * gas = 10^16
            // gasFeeCTSI = gasFee * 10^18 / ctsiPrice = 10^16 * 10^18 / 10^15 = 10^34 / 10^15 = 10^19 = 10 CTSI
            const contract = await deploy(gas, gasPrice, ctsiPrice);
            expect(await contract.getCommission(0, reward)).to.equal(
                ethers.utils.parseUnits("10", 18)
            );
        });

        it("should calculate 10% fee for 1/10 of gas price", async () => {
            const reward = ethers.utils.parseUnits("10", 18); // 10^19 = 10 CTSI
            const gas = 100000; // 10^5
            const gasPrice = ethers.utils.parseUnits("10", "gwei"); // 10^10
            const ctsiPrice = ethers.utils.parseEther("0.001"); // 10^15

            // gasFee = gasPrice * gas = 10^15
            // gasFeeCTSI = gasFee * 10^18 / ctsiPrice = 10^15 * 10^18 / 10^15 = 10^33 / 10^15 = 10^18 = 1 CTSI
            const contract = await deploy(gas, gasPrice, ctsiPrice);
            expect(await contract.getCommission(0, reward)).to.equal(
                ethers.utils.parseUnits("1", 18)
            );
        });

        it("should calculate 100% fee for 1/10 of CTSI price, cap to reward", async () => {
            const reward = ethers.utils.parseUnits("10", 18); // 10^19 = 10 CTSI
            const gas = 100000; // 10^5
            const gasPrice = ethers.utils.parseUnits("100", "gwei"); // 10^11
            const ctsiPrice = ethers.utils.parseEther("0.0001"); // 10^14

            // gasFee = gasPrice * gas = 10^16
            // gasFeeCTSI = gasFee * 10^18 / ctsiPrice = 10^16 * 10^18 / 10^14 = 10^34 / 10^14 = 10^20 = 100 CTSI
            const contract = await deploy(gas, gasPrice, ctsiPrice);
            expect(await contract.getCommission(0, reward)).to.equal(
                ethers.utils.parseUnits("10", 18)
            );
        });

        it("should reduce the commission correctly", async () => {
            const gas = 100000; // 10^5
            const gasPrice = ethers.utils.parseUnits("100", "gwei");
            const ctsiPrice = ethers.utils.parseUnits("1", 4); // 10^4
            const contract = await deploy(gas, gasPrice, ctsiPrice);

            const newCommission = 50000; // 5*10^4
            await expect(contract.setGas(newCommission))
                .to.emit(contract, "GasTaxChanged")
                .withArgs(newCommission, 0);
            expect(await contract.gas()).to.be.equal(newCommission);
        });

        it("should fail to reduce commission if not called by owner", async () => {
            const [, secSigner] = await ethers.getSigners();
            const gas = 100000; // 10^5
            const gasPrice = ethers.utils.parseUnits("100", "gwei");
            const ctsiPrice = ethers.utils.parseUnits("1", 4); // 10^4
            const contract = await deploy(gas, gasPrice, ctsiPrice);

            const tx = contract.connect(secSigner).setGas(0);
            await expect(tx).to.be.revertedWith(
                "Ownable: caller is not the owner"
            );
        });

        it("should add timeout if commission new value is equal or higher", async () => {
            const [signer] = await ethers.getSigners();
            const provider = signer.provider || ethers.getDefaultProvider();
            const gas = 100000; // 10^5
            const gasPrice = ethers.utils.parseUnits("100", "gwei");
            const ctsiPrice = ethers.utils.parseUnits("1", 4); // 10^4
            const ts = Date.now();
            await setNextBlockTimestamp(provider, ts);
            const contract = await deploy(gas, gasPrice, ctsiPrice);
            await expect(contract.setGas(gas))
                .to.emit(contract, "GasTaxChanged")
                .withArgs(gas, 0);
            expect(await contract.gas()).to.be.equal(gas);

            const nextTS = ts + 10;
            await setNextBlockTimestamp(contract.provider, nextTS);
            await expect(contract.setGas(gas + 1))
                .to.emit(contract, "GasTaxChanged")
                .withArgs(gas + 1, nextTS + FeeRaiseTimeout);
            expect(await contract.gas()).to.be.equal(gas + 1);
        });

        it("should fail to raise commission if timeout is not over", async () => {
            const [signer] = await ethers.getSigners();
            const provider = signer.provider || ethers.getDefaultProvider();
            const gas = 100000; // 10^5
            const gasPrice = ethers.utils.parseUnits("100", "gwei");
            const ctsiPrice = ethers.utils.parseUnits("1", 4); // 10^4
            const ts = Date.now();
            await setNextBlockTimestamp(provider, ts);
            const contract = await deploy(gas, gasPrice, ctsiPrice);

            const nextTS = ts + 10;
            await setNextBlockTimestamp(contract.provider, nextTS);

            await expect(contract.setGas(gas + 1))
                .to.emit(contract, "GasTaxChanged")
                .withArgs(gas + 1, nextTS + FeeRaiseTimeout);
            await expect(contract.setGas(gas + 2)).to.be.revertedWith(
                "GasTaxCommission: the fee raise timeout is not expired yet"
            );
        });

        it("should fail to raise commission if over max", async () => {
            const gas = 100000; // 10^5
            const gasPrice = ethers.utils.parseUnits("100", "gwei");
            const ctsiPrice = ethers.utils.parseUnits("1", 4); // 10^4
            const contract = await deploy(gas, gasPrice, ctsiPrice);
            await expect(
                contract.setGas(gas + maxGasRaise + 1)
            ).to.be.revertedWith(
                "GasTaxCommission: the fee raise is over the maximum allowed gas value"
            );
        });
    });
});
