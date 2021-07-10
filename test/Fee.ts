// Copyright 2021 Cartesi Pte. Ltd.

// Licensed under the Apache License, Version 2.0 (the "License"); you may not use
// this file except in compliance with the License. You may obtain a copy of the
// License at http://www.apache.org/licenses/LICENSE-2.0

// Unless required by applicable law or agreed to in writing, software distributed
// under the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR
// CONDITIONS OF ANY KIND, either express or implied. See the License for the
// specific language governing permissions and limitations under the License.

import { expect, use } from "chai";
import { ethers } from "hardhat";
import { BigNumberish, Signer } from "ethers";
import { solidity, deployMockContract } from "ethereum-waffle";
import AgregatorInterface from "@chainlink/contracts/abi/v0.8/AggregatorInterface.json";
import IUniswapV2Pair from "@uniswap/v2-core/build/IUniswapV2Pair.json";

import { FlatRateCommission } from "../src/types/FlatRateCommission";
import { FlatRateCommission__factory } from "../src/types/factories/FlatRateCommission__factory";
import { GasTaxCommission } from "../src/types/GasTaxCommission";
import { GasTaxCommission__factory } from "../src/types/factories/GasTaxCommission__factory";

use(solidity);

describe("FlatRateCommission", async () => {
    const commission = 1000; // 10%
    let signer: Signer;
    let secSigner: Signer;
    let signerAddress: string;
    let contract: FlatRateCommission;

    const deploy = async (commission: number): Promise<FlatRateCommission> => {
        const [signer] = await ethers.getSigners();
        const factory = new FlatRateCommission__factory(signer);
        return factory.deploy(commission);
    };

    beforeEach(async () => {
        [signer, secSigner] = await ethers.getSigners();
        signerAddress = await signer.getAddress();
        contract = await deploy(commission);
        // XXX: how to use expect().to.emit(contract, event) when a constructor is emitting?
    });

    it("should calculate 10% correctly on getCommission", async () => {
        const value = 200;
        expect(await contract.getCommission(0, value)).to.equal(value * 0.1);
    });

    it("should reduce the commission correctly", async () => {
        const newCommission = 500;
        await expect(contract.setRate(newCommission))
            .to.emit(contract, "FlatRateChanged")
            .withArgs(newCommission);
        expect(await contract.rate()).to.be.equal(newCommission);
    });

    it("should fail to reduce commission if not called by owner", async () => {
        const newCommission = 500;
        const tx = contract.connect(secSigner).setRate(newCommission);
        await expect(tx).to.be.revertedWith("Ownable: caller is not the owner");
    });

    it("should fail to reduce commission if new value is equal or higher", async () => {
        let tx = contract.setRate(commission);
        await expect(tx).to.be.revertedWith(
            "newRate needs to be strictly smaller than current rate."
        );
        tx = contract.setRate(commission + 1);
        await expect(tx).to.be.revertedWith(
            "newRate needs to be strictly smaller than current rate."
        );
    });
});

describe("GasTaxCommission", async () => {
    const deploy = async (
        gas: BigNumberish,
        gasPrice: BigNumberish,
        ctsiReserve: BigNumberish,
        ethReserve: BigNumberish
    ): Promise<GasTaxCommission> => {
        const [signer] = await ethers.getSigners();

        // build a chainlink oracle mock returning the specified gas price
        const chainlinkOracle = await deployMockContract(
            signer,
            AgregatorInterface
        );
        chainlinkOracle.mock.latestAnswer.returns(gasPrice);

        // build a uniswap oracle mock returning the specified reserves
        const uniswapOracle = await deployMockContract(
            signer,
            IUniswapV2Pair.abi
        );
        uniswapOracle.mock.getReserves.returns(ctsiReserve, ethReserve, 0);

        // deploy the contract
        const factory = new GasTaxCommission__factory(signer);
        return factory.deploy(
            chainlinkOracle.address,
            uniswapOracle.address,
            gas
        );
    };

    it("should be zero if charging zero gas", async () => {
        const gasPrice = ethers.utils.parseUnits("100", "gwei");
        const contract = await deploy(0, gasPrice, 1, 1);
        expect(await contract.getCommission(0, 100)).to.equal(0);
    });

    it("should be zero if there is no eth reserve to calculate price in CTSI", async () => {
        const gasPrice = ethers.utils.parseUnits("100", "gwei");
        const contract = await deploy(1000000, gasPrice, 1, 0);
        expect(await contract.getCommission(0, 100)).to.equal(0);
    });

    it("should calculate 100% fee", async () => {
        const reward = ethers.utils.parseUnits("100", 18); // 10^20 = 100 CTSI
        const gas = 100000; // 10^5
        const gasPrice = ethers.utils.parseUnits("100", "gwei"); // 10^11
        const ctsiReserve = ethers.utils.parseUnits("100000", 18); // 10^23
        const ethReserve = ethers.utils.parseUnits("10", 18); // 10^19
        // gasFee = gasPrice * gas = 10^16
        // gasFeeCTSI = gasFee * ctsiReserve / ethReserve = 10^16 * 10^23 / 10^19 = 10^20 = 100 CTSI
        const contract = await deploy(gas, gasPrice, ctsiReserve, ethReserve);
        expect(await contract.getCommission(0, reward)).to.equal(
            ethers.utils.parseUnits("100", 18)
        );
    });

    it("should calculate 10% fee for 1/10 of gas price", async () => {
        const reward = ethers.utils.parseUnits("100", 18); // 10^20 = 100 CTSI
        const gas = 100000; // 10^5
        const gasPrice = ethers.utils.parseUnits("10", "gwei"); // 10^10
        const ctsiReserve = ethers.utils.parseUnits("100000", 18); // 10^23
        const ethReserve = ethers.utils.parseUnits("10", 18); // 10^19
        // gasFee = gasPrice * gas = 10^15
        // gasFeeCTSI = gasFee * ctsiReserve / ethReserve = 10^15 * 10^23 / 10^19 = 10^19 = 10 CTSI
        const contract = await deploy(gas, gasPrice, ctsiReserve, ethReserve);
        expect(await contract.getCommission(0, reward)).to.equal(
            ethers.utils.parseUnits("10", 18)
        );
    });

    it("should calculate 100% fee for 1/10 of CTSI price, cap to reward", async () => {
        const reward = ethers.utils.parseUnits("100", 18); // 10^20 = 100 CTSI
        const gas = 100000; // 10^5
        const gasPrice = ethers.utils.parseUnits("100", "gwei"); // 10^11
        const ctsiReserve = ethers.utils.parseUnits("1000000", 18); // 10^24
        const ethReserve = ethers.utils.parseUnits("10", 18); // 10^19
        // gasFee = gasPrice * gas = 10^16
        // gasFeeCTSI = gasFee * ctsiReserve / ethReserve = 10^16 * 10^24 / 10^19 = 10^21 = 1000 CTSI
        const contract = await deploy(gas, gasPrice, ctsiReserve, ethReserve);
        expect(await contract.getCommission(0, reward)).to.equal(
            ethers.utils.parseUnits("100", 18)
        );
    });

    it("should reduce the commission correctly", async () => {
        const gas = 100000; // 10^5
        const gasPrice = ethers.utils.parseUnits("100", "gwei");
        const contract = await deploy(gas, gasPrice, 1, 1);

        const newCommission = 50000; // 5*10^4
        await expect(contract.setGas(newCommission))
            .to.emit(contract, "GasTaxChanged")
            .withArgs(newCommission);
        expect(await contract.gas()).to.be.equal(newCommission);
    });

    it("should fail to reduce commission if not called by owner", async () => {
        const [, secSigner] = await ethers.getSigners();
        const gas = 100000; // 10^5
        const gasPrice = ethers.utils.parseUnits("100", "gwei");
        const contract = await deploy(gas, gasPrice, 1, 1);

        const tx = contract.connect(secSigner).setGas(0);
        await expect(tx).to.be.revertedWith("Ownable: caller is not the owner");
    });

    it("should fail to reduce commission if new value is equal or higher", async () => {
        const gas = 100000; // 10^5
        const gasPrice = ethers.utils.parseUnits("100", "gwei");
        const contract = await deploy(gas, gasPrice, 1, 1);

        let tx = contract.setGas(gas);
        await expect(tx).to.be.revertedWith(
            "newGasCommission needs to be strictly smaller than the current value."
        );
        tx = contract.setGas(gas + 1);
        await expect(tx).to.be.revertedWith(
            "newGasCommission needs to be strictly smaller than the current value."
        );
    });
});
