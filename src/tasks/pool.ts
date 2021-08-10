// Copyright 2021 Cartesi Pte. Ltd.

// SPDX-License-Identifier: Apache-2.0
// Licensed under the Apache License, Version 2.0 (the "License"); you may not use
// this file except in compliance with the License. You may obtain a copy of the
// License at http://www.apache.org/licenses/LICENSE-2.0

// Unless required by applicable law or agreed to in writing, software distributed
// under the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR
// CONDITIONS OF ANY KIND, either express or implied. See the License for the
// specific language governing permissions and limitations under the License.

import { HardhatRuntimeEnvironment, TaskArguments } from "hardhat/types";
import { task, types } from "hardhat/config";
import { BigNumber, constants } from "ethers";
import { CartesiToken__factory } from "@cartesi/token";

task("pool:create", "Create a staking pool")
    .addOptionalParam(
        "commission",
        "Flat rate commission, from 0 to 10000",
        undefined,
        types.int
    )
    .addOptionalParam("gas", "Gas tax commission", undefined, types.int)
    .setAction(async (args: TaskArguments, hre: HardhatRuntimeEnvironment) => {
        const { deployments, ethers } = hre;
        const { StakingPoolFactoryImpl__factory } =
            await require("../types/factories/StakingPoolFactoryImpl__factory");
        const { StakingPoolImpl, StakingPoolFactoryImpl } = await deployments.all();
        const [deployer] = await ethers.getSigners();

        const poolFactory = StakingPoolFactoryImpl__factory.connect(
            StakingPoolFactoryImpl.address,
            deployer
        );

        // configure factory if needed
        const referencePool = await poolFactory.referencePool();
        if (referencePool == ethers.constants.AddressZero) {
            console.log(
                `setting up reference pool to ${StakingPoolImpl.address}`
            );
            const tx = await poolFactory.setReferencePool(StakingPoolImpl.address);
            await tx.wait(1);
        }

        let tx;
        if (args.commission) {
            // flat rate commission
            const commission = BigNumber.from(args.commission);

            // create pool
            tx = await poolFactory.createFlatRateCommission(commission, {
                value: ethers.utils.parseEther("0.001"), // this is the minimum amount of ETH required by the WorkerManager
            });
        } else if (args.gas) {
            // gas tax commission
            tx = await poolFactory.createGasTaxCommission(args.gas, {
                value: ethers.utils.parseEther("0.001"), // this is the minimum amount of ETH required by the WorkerManager
            });
        }

        if (!tx) {
            throw new Error("invalid commission value");
        }

        console.log(`pool created, tx: ${tx.hash}`);

        const receipt = await tx.wait(1);
        console.log(receipt.events);

        if (receipt.events) {
            const event = receipt.events.find(
                (e: any) =>
                    e.event == "NewFlatRateCommissionStakingPool" ||
                    e.event == "NewGasTaxCommissionStakingPool"
            );
            if (event && event.args && event.args.length > 0) {
                const poolAddress = event.args[0];
                console.log(`pool: ${poolAddress}`);
            } else {
                console.warn(
                    "Event NewFlatRateCommissionStakingPool or NewGasTaxCommissionStakingPool not found"
                );
            }
        } else {
            console.warn("No events found");
        }
    });

task("pool:list", "List staking pools").setAction(
    async (_args: TaskArguments, hre: HardhatRuntimeEnvironment) => {
        const { deployments, ethers } = hre;
        const { StakingPoolFactory__factory } =
            await require("../types/factories/StakingPoolFactory__factory");
        const { StakingPoolFactoryImpl } = await deployments.all();
        const [deployer] = await ethers.getSigners();

        const poolFactory = StakingPoolFactory__factory.connect(
            StakingPoolFactoryImpl.address,
            deployer
        );

        const pools = await poolFactory.queryFilter(
            poolFactory.filters.NewFlatRateCommissionStakingPool(null, null)
        );
        console.log(
            pools.map((p: any) => ({
                pool: p.args.pool,
                fee: p.args.fee,
            }))
        );
    }
);

task("pool:stake", "Stake CTSI to a pool")
    .addPositionalParam("pool", "Pool address", undefined, types.string, false)
    .addPositionalParam(
        "amount",
        "Amount to stake",
        undefined,
        types.int,
        false
    )
    .setAction(async (args: TaskArguments, hre: HardhatRuntimeEnvironment) => {
        const { deployments, ethers } = hre;
        const { StakingPool__factory } =
            await require("../types/factories/StakingPool__factory");
        const [deployer] = await ethers.getSigners();
        const { CartesiToken } = await deployments.all();

        const ctsi = CartesiToken__factory.connect(
            CartesiToken.address,
            deployer
        );

        // TODO: change this
        const user = deployer.address;

        const amount = BigNumber.from(args.amount).mul(constants.WeiPerEther);
        const poolAddress = args.pool;
        const pool = StakingPool__factory.connect(poolAddress, deployer);

        const allowance = await ctsi.allowance(user, poolAddress);
        if (amount.gt(allowance)) {
            console.log(
                `increasing allowance of ${allowance.toString()} to ${amount.toString()}`
            );
            const tx = await ctsi.approve(poolAddress, amount);
            const receipt = await tx.wait(1);
            console.log(receipt);
        }

        const tx = await pool.stake(amount);
        const receipt = await tx.wait(1);
        console.log(receipt);
    });

task("pool:name", "Name a pool")
    .addPositionalParam("pool", "Pool address", undefined, types.string, false)
    .addPositionalParam(
        "name",
        "ENS domain name of pool",
        undefined,
        types.string,
        false
    )
    .setAction(async (args: TaskArguments, hre: HardhatRuntimeEnvironment) => {
        const { ethers } = hre;
        const { StakingPool__factory } =
            await require("../types/factories/StakingPool__factory");
        const [deployer] = await ethers.getSigners();

        const poolAddress = args.pool;
        const pool = StakingPool__factory.connect(poolAddress, deployer);
        const tx = await pool.setName(args.name);
        const receipt = await tx.wait(1);
        console.log(receipt);
    });

task("pool:verify", "Verify a pool on etherscan")
    .addPositionalParam("address", "Pool address", undefined, types.string)
    .setAction(async (args: TaskArguments, hre: HardhatRuntimeEnvironment) => {
        const { deployments, ethers } = hre;
        const {
            CartesiToken,
            PoS,
            StakingImpl,
            WorkerManagerAuthManagerImpl,
            MockAggregator,
            MockUniswapV2Pair,
        } = await deployments.all();

        const { StakingPoolImpl__factory } =
            await require("../types/factories/StakingPoolImpl__factory");
        const { GasTaxCommission__factory } =
            await require("../types/factories/GasTaxCommission__factory");
        const { FlatRateCommission__factory } =
            await require("../types/factories/FlatRateCommission__factory");

        const network = await ethers.getDefaultProvider().getNetwork();
        const ensAddress = network.ensAddress || ethers.constants.AddressZero;
        const pool = StakingPoolImpl__factory.connect(
            args.address,
            ethers.provider
        );

        // GaxTaxCommission
        const gasTaxArgs = async (address: string): Promise<any[]> => {
            const fee = GasTaxCommission__factory.connect(
                address,
                ethers.provider
            );
            const gas = await fee.gas();
            const gasOracle = MockAggregator.address;
            const priceOracle = MockUniswapV2Pair.address;
            return [gasOracle, priceOracle, gas];
        };

        // FlatRateCommission
        const flatRateArgs = async (address: string): Promise<any[]> => {
            const fee = FlatRateCommission__factory.connect(
                address,
                ethers.provider
            );
            const rate = await fee.rate();
            return [rate];
        };

        // verify the commission contract
        const feeAddress = await pool.fee();

        console.log(`verifying fee ${feeAddress}`);

        let feeArgs = undefined;
        try {
            // try with a FlatRateArgs
            feeArgs = await flatRateArgs(feeAddress);
        } catch (e) {
            // error, try with a GaxTaxArgs
            feeArgs = await gasTaxArgs(feeAddress);
        }

        await hre.run("verify:verify", {
            address: feeAddress,
            constructorArguments: feeArgs,
        });

        console.log(`verifying pool ${args.address}`);
        await hre.run("verify:verify", {
            address: args.address,
            constructorArguments: [
                CartesiToken.address,
                StakingImpl.address,
                PoS.address,
                21600, // TODO: this will be a parameter
                172800, // TODO: this will be a parameter
                ensAddress,
                WorkerManagerAuthManagerImpl.address,
            ],
        });
    });
