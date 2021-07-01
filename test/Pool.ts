// Copyright 2021 Cartesi Pte. Ltd.

// Licensed under the Apache License, Version 2.0 (the "License"); you may not use
// this file except in compliance with the License. You may obtain a copy of the
// License at http://www.apache.org/licenses/LICENSE-2.0

// Unless required by applicable law or agreed to in writing, software distributed
// under the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR
// CONDITIONS OF ANY KIND, either express or implied. See the License for the
// specific language governing permissions and limitations under the License.

import { expect, use } from "chai";
import { BigNumber, Signer } from "ethers";
import { JsonRpcProvider } from "@ethersproject/providers";
import { deployments, ethers, waffle } from "hardhat";
import { MockContract } from "@ethereum-waffle/mock-contract";

import { StakingPoolImpl } from "../src/types/StakingPoolImpl";
import { StakingPoolImpl__factory } from "../src/types/factories/StakingPoolImpl__factory";
import { CloneMaker__factory } from "../src/types/factories/CloneMaker__factory";

import { advanceTime, advanceBlock, setNextBlockTimestamp } from "./utils";
const { solidity, deployMockContract, loadFixture } = waffle;
import ENS from "@ensdomains/ens/build/contracts/ENS.json";
import ReverseRegistrar from "@ensdomains/ens/build/contracts/ReverseRegistrar.json";

use(solidity);

const errorCheck = (
    value: BigNumber,
    expectedValue: BigNumber,
    error = 0.00001
) => {
    const base = 1000000;
    const diff = value.sub(expectedValue).abs();
    const trueError = diff.mul(base).div(expectedValue).toNumber() / base;
    expect(trueError).to.be.lessThan(error);
};

describe("StakingPool", async () => {
    const DAY = 86400; // seconds in a day
    const MATURATION = 5 * DAY;
    const RELEASE = 5 * DAY;
    const COMMISSION = 500; // 5%
    const FIXED_POINT_DECIMALS = 10e5;

    let provider: JsonRpcProvider;
    let signer: Signer;
    let poolManager: Signer;
    let secSigner: Signer;
    let thirdSigner: Signer;
    let signerAddress: string;
    let secSignerAddress: string;
    let thirdSignerAddress: string;
    let poolManagerAddress: string;

    let stakingPool: StakingPoolImpl;
    let mockToken: MockContract;
    let mockStaking: MockContract;
    let mockPoS: MockContract;
    let mockRewardManager: MockContract;
    let mockFee: MockContract;
    let mockWorkerAuthManagerImpl: MockContract;

    let stakingMaturingTimestamp: number;

    const deployPool = async (
        {
            ctsi,
            staking,
            pos,
            fee,
            ens,
            workerManagerAuthManager,
        }: {
            ctsi?: string;
            staking?: string;
            pos?: string;
            fee: string;
            ens: string;
            workerManagerAuthManager?: string;
        } = {
            fee: ethers.constants.AddressZero,
            ens: ethers.constants.AddressZero,
        }
    ): Promise<StakingPoolImpl> => {
        const cloneFactoryDeployment = await deployments.deploy("CloneMaker", {
            from: signerAddress,
        });
        const CloneMakerFactory = new CloneMaker__factory();
        const CloneMaker = CloneMakerFactory.attach(
            cloneFactoryDeployment.address
        ).connect(signer);
        const ctsiAddress =
            ctsi || (await deployments.get("CartesiToken")).address;
        const stakingAddress =
            staking || (await deployments.get("StakingImpl")).address;
        const posAddress = pos || (await deployments.get("PoS")).address;
        const workerAuthManagerAddress =
            workerManagerAuthManager ||
            (await deployments.get("WorkerManagerAuthManagerImpl")).address;
        const stakingFactory = new StakingPoolImpl__factory(poolManager);
        const stakingPoolReference = await stakingFactory.deploy(
            ctsiAddress,
            stakingAddress,
            posAddress,
            MATURATION,
            RELEASE,
            ens,
            workerAuthManagerAddress
        );
        const tx = await CloneMaker.clone(stakingPoolReference.address);
        const receipt = await tx.wait();
        if (!receipt.events || !receipt.events[0].args)
            throw "error on cloning deployment";
        const newPoolAddress = receipt.events[0].args[0];
        const stakingPool = stakingFactory
            .attach(newPoolAddress)
            .connect(poolManager);
        await stakingPool.initialize(fee, poolManagerAddress);
        return stakingPool.connect(signer);
    };

    const beforeFixture = async () => {
        [signer, secSigner, thirdSigner, poolManager] =
            await ethers.getSigners();
        provider = signer.provider as JsonRpcProvider;
        signerAddress = await signer.getAddress();
        secSignerAddress = await secSigner.getAddress();
        thirdSignerAddress = await thirdSigner.getAddress();
        poolManagerAddress = await poolManager.getAddress();

        const CartesiToken = await deployments.getArtifact("CartesiToken");
        const StakingImpl = await deployments.getArtifact("StakingImpl");
        const PoS = await deployments.getArtifact("PoS");
        const RewardManager = await deployments.getArtifact("RewardManager");
        const WorkerManagerAuthManagerImpl = await deployments.getArtifact(
            "WorkerManagerAuthManagerImpl"
        );
        const FlatRateCommission = await deployments.getArtifact(
            "FlatRateCommission"
        );

        mockToken = await deployMockContract(signer, CartesiToken.abi);
        mockStaking = await deployMockContract(signer, StakingImpl.abi);
        mockPoS = await deployMockContract(signer, PoS.abi);
        mockRewardManager = await deployMockContract(signer, RewardManager.abi);
        mockWorkerAuthManagerImpl = await deployMockContract(
            signer,
            WorkerManagerAuthManagerImpl.abi
        );
        mockFee = await deployMockContract(signer, FlatRateCommission.abi);

        const mockENS = await deployMockContract(signer, ENS.abi);
        const mockReverseRegistrar = await deployMockContract(
            signer,
            ReverseRegistrar.abi
        );
        await mockENS.mock.owner.returns(mockReverseRegistrar.address);
        await mockReverseRegistrar.mock.setName.returns(
            ethers.constants.HashZero
        );

        await mockWorkerAuthManagerImpl.mock.hire.returns();
        await mockWorkerAuthManagerImpl.mock.authorize.returns();

        await mockToken.mock.approve
            .withArgs(mockStaking.address, ethers.constants.MaxUint256)
            .returns(true);

        stakingPool = await deployPool({
            ctsi: mockToken.address,
            staking: mockStaking.address,
            pos: mockPoS.address,
            fee: mockFee.address,
            ens: mockENS.address,
            workerManagerAuthManager: mockWorkerAuthManagerImpl.address,
        });
    };

    beforeEach(async () => {
        stakingMaturingTimestamp = Math.trunc(Date.now() / 1000) + MATURATION;
        await loadFixture(beforeFixture);
    });

    describe("Management", async () => {
        it("should set name", async () => {
            const name = "test.eth";

            // setName called by some user must revert...
            await expect(stakingPool.setName(name)).to.be.reverted;

            // ...because only pool manager can set name
            await expect(stakingPool.connect(poolManager).setName(name))
                .to.emit(stakingPool, "StakingPoolRenamed")
                .withArgs(name);
        });

        it("should be unpaused", async () => {
            expect(await stakingPool.paused()).to.equal(false);
        });

        it("should be paused", async () => {
            // should revert because need to be called by owner
            await expect(stakingPool.pause()).to.be.revertedWith(
                "Ownable: caller is not the owner"
            );

            // pause with the pool manager account
            await expect(stakingPool.connect(poolManager).pause()).to.emit(
                stakingPool,
                "Paused"
            );

            expect(await stakingPool.paused()).to.equal(true);
        });

        it("should not allow stake while paused", async () => {
            await stakingPool.connect(poolManager).pause();
            expect(await stakingPool.paused()).to.equal(true);
            await expect(stakingPool.stake(100)).to.be.revertedWith(
                "Pausable: paused"
            );

            // should revert because unlock need to be called by owner
            await expect(stakingPool.unpause()).to.be.revertedWith(
                "Ownable: caller is not the owner"
            );

            // unlock with the pool manager account
            await expect(stakingPool.connect(poolManager).unpause()).to.emit(
                stakingPool,
                "Unpaused"
            );

            // stake should now work
            await mockToken.mock.transferFrom.returns(true);
            await mockStaking.mock.getMaturingTimestamp.returns(
                stakingMaturingTimestamp
            );
            await stakingPool.stake(100);
        });
    });

    describe("CTSI Token states transitions", async () => {
        it("should lock balance correctly", async () => {
            // stake/lock balance
            // get the correct locked balance
            // get the correct maturing timestamp
            const stakedValue = 100;

            await mockToken.mock.transferFrom.returns(true);
            await mockStaking.mock.getMaturingTimestamp.returns(
                stakingMaturingTimestamp
            );
            const tx = stakingPool.stake(stakedValue);
            await expect(tx)
                .to.emit(stakingPool, "Stake")
                .withArgs(
                    signerAddress,
                    stakedValue,
                    stakingMaturingTimestamp + MATURATION
                );

            // the balance is seen as maturing, even though it's not in the staking contract yet
            expect(
                await stakingPool.getMaturingBalance(signerAddress)
            ).to.equal(stakedValue);

            // the maturation is set to a MATURATION period further
            expect(
                await stakingPool.getMaturingTimestamp(signerAddress)
            ).to.equal(stakingMaturingTimestamp + MATURATION);

            const userBalances = await stakingPool.userBalance(signerAddress);
            expect(userBalances.stakingVoucher.amountQueued).to.equal(
                stakedValue
            );
            expect(userBalances.stakingVoucher.amountStaked).to.equal(0);
        });

        it("should have maturing balance after 1 time window", async () => {
            const stakedValue = 100;
            await mockToken.mock.transferFrom.returns(true);
            await mockStaking.mock.getMaturingBalance.returns(0);
            await mockStaking.mock.getMaturingTimestamp.returns(
                stakingMaturingTimestamp
            );
            let tx = await stakingPool.stake(stakedValue);

            expect(
                await stakingPool.getMaturingBalance(signerAddress)
            ).to.equal(stakedValue);

            // go past the maturation window, and produce a block
            await advanceTime(provider, MATURATION);
            await advanceBlock(provider);

            expect(
                await stakingPool.getMaturingBalance(signerAddress)
            ).to.equal(stakedValue);

            expect(
                await stakingPool.getMaturingTimestamp(signerAddress)
            ).to.equal(stakingMaturingTimestamp + MATURATION); // before finishing the last cycle it takes current cycle + 1 to maturate

            await mockToken.mock.approve.returns(true);
            await mockStaking.mock.stake.returns();
            tx = await stakingPool.cycleStakeMaturation(); // makes a maturation cycle update where a staking.stake() call is made

            await mockStaking.mock.getMaturingTimestamp.returns(
                stakingMaturingTimestamp + MATURATION // updates with the advancement of time
            );

            expect(
                await stakingPool.getMaturingBalance(signerAddress)
            ).to.equal(stakedValue);

            expect(
                await stakingPool.getMaturingTimestamp(signerAddress)
            ).to.be.equal(stakingMaturingTimestamp + MATURATION);
        });

        it("should have matured balance after '2' time windows", async () => {
            const stakedValue = 100;

            await mockToken.mock.transferFrom.returns(true);
            await mockToken.mock.approve.returns(true);
            await mockStaking.mock.stake.returns();
            await mockStaking.mock.getMaturingBalance.returns(0);
            await mockStaking.mock.getMaturingTimestamp.returns(
                stakingMaturingTimestamp
            );
            let tx = await stakingPool.stake(stakedValue);

            await advanceTime(provider, MATURATION);
            await advanceBlock(provider);
            tx = await stakingPool.cycleStakeMaturation(); // makes a maturation cycle update

            await advanceTime(provider, MATURATION);
            await advanceBlock(provider);
            tx = await stakingPool.cycleStakeMaturation(); // makes a maturation cycle update

            // maturing balance should be zero, and moved to mature
            expect(
                await stakingPool.getMaturingBalance(signerAddress)
            ).to.be.equal(0);

            // amount should be mature at this point
            expect(await stakingPool.getStakedBalance(signerAddress)).to.equal(
                stakedValue
            );
        });

        it("should have matured balance after '2' uncommited time windows", async () => {
            // when time has passed but no call cycleStakeMaturation has been made
            const stakedValue = 100;

            await mockToken.mock.transferFrom.returns(true);
            await mockToken.mock.approve.returns(true);
            await mockStaking.mock.stake.returns();
            await mockStaking.mock.getMaturingBalance.returns(0);
            await mockStaking.mock.getMaturingTimestamp.returns(
                stakingMaturingTimestamp
            );
            let tx = await stakingPool.stake(stakedValue);

            await advanceTime(provider, MATURATION);
            await advanceBlock(provider);
            tx = await stakingPool.cycleStakeMaturation(); // makes a maturation cycle update

            await advanceTime(provider, MATURATION);
            await advanceBlock(provider);

            await mockStaking.mock.getMaturingTimestamp.returns(0);
            // maturing balance should be zero, and moved to mature
            expect(
                await stakingPool.getMaturingBalance(signerAddress)
            ).to.be.equal(0);

            // amount should be mature at this point
            expect(await stakingPool.getStakedBalance(signerAddress)).to.equal(
                stakedValue
            );
        });

        it("should unstake correctly", async () => {
            const stakedValue = 100;

            await mockToken.mock.transferFrom.returns(true);
            await mockToken.mock.approve.returns(true);
            await mockStaking.mock.stake.returns();
            await mockStaking.mock.getMaturingBalance.returns(0);
            await mockStaking.mock.getMaturingTimestamp.returns(
                stakingMaturingTimestamp
            );
            await stakingPool.stake(stakedValue);

            await advanceTime(provider, MATURATION);
            await advanceBlock(provider);
            await stakingPool.cycleStakeMaturation(); // makes a maturation cycle update

            await advanceTime(provider, MATURATION);
            await advanceBlock(provider);
            await stakingPool.cycleStakeMaturation(); // makes a maturation cycle update

            const release = stakingMaturingTimestamp + 2 * MATURATION;

            await setNextBlockTimestamp(provider, release - 1); // this method increases 1 on the next block
            await mockStaking.mock.getReleasingBalance.returns(0);
            let tx = stakingPool.unstakeCTSI(stakedValue);
            await expect(tx)
                .to.emit(stakingPool, "Unstake")
                .withArgs(signerAddress, stakedValue, release + RELEASE);

            expect(
                await stakingPool.getReleasingTimestamp(signerAddress)
            ).to.be.equal(release + RELEASE);

            expect(
                await stakingPool.getReleasingBalance(signerAddress)
            ).to.be.equal(stakedValue);

            const balances = await stakingPool.userBalance(signerAddress);
            const unstakeEpoch = await stakingPool.currentUnstakeEpoch();
            expect(balances.stakedPoolShares).to.equal(0);
            expect(balances.unstakingVoucher.amount).to.equal(stakedValue);

            expect(balances.unstakingVoucher.queueEpoch).to.equal(unstakeEpoch);
            // since it didn't call staking.unstake() yet, it's balance still counts for reward
            expect(await stakingPool.totalStakedShares()).to.equal(0);
            expect(await stakingPool.getStakedBalance(signerAddress)).to.equal(
                0
            );
        });

        it("should have releasing balance after '1' time window", async () => {
            const stakedValue = 100;

            await mockToken.mock.transferFrom.returns(true);
            await mockToken.mock.approve.returns(true);
            await mockStaking.mock.stake.returns();
            await mockStaking.mock.getMaturingBalance.returns(0);
            await mockStaking.mock.getMaturingTimestamp.returns(
                stakingMaturingTimestamp
            );
            await stakingPool.stake(stakedValue);

            await advanceTime(provider, MATURATION);
            await advanceBlock(provider);
            await stakingPool.cycleStakeMaturation(); // makes a maturation cycle update

            await mockStaking.mock.getMaturingBalance.returns(stakedValue);
            await advanceTime(provider, MATURATION);
            await advanceBlock(provider);
            await stakingPool.cycleStakeMaturation(); // makes a maturation cycle update

            await mockStaking.mock.getReleasingBalance.returns(10); //fake as if there is something there
            await mockStaking.mock.getReleasingTimestamp.returns(0);
            await stakingPool.unstakeCTSI(stakedValue);

            await mockStaking.mock.unstake.withArgs(stakedValue).returns();
            await mockStaking.mock.getReleasingBalance.returns(0); // avoid having a staking.withdraw() call at this time
            await stakingPool.cycleWithdrawRelease(); // force a release cycle update

            expect(
                await stakingPool.getReleasingTimestamp(signerAddress)
            ).to.be.equal(0); // it returns what the mock returns

            expect(
                await stakingPool.getReleasingBalance(signerAddress)
            ).to.be.equal(stakedValue);

            const balances = await stakingPool.userBalance(signerAddress);

            expect(balances.stakedPoolShares).to.equal(0);
            expect(balances.unstakingVoucher.amount).to.equal(stakedValue);
            expect(
                balances.unstakingVoucher.queueEpoch.toNumber() + 1
            ).to.equal(await stakingPool.currentUnstakeEpoch());
            expect(await stakingPool.totalStakedShares()).to.equal(0);
            expect(await stakingPool.getStakedBalance(signerAddress)).to.equal(
                0
            );
        });

        it("should withdraw balance correctly after '2' time windows", async () => {
            const stakedValue = 100;
            const stakingReleasingBalance = 10;
            await mockToken.mock.transferFrom.returns(true);
            await mockToken.mock.approve.returns(true);
            await mockStaking.mock.stake.returns();
            await mockStaking.mock.getMaturingBalance.returns(0);
            await mockStaking.mock.getMaturingTimestamp.returns(
                stakingMaturingTimestamp
            );
            await stakingPool.stake(stakedValue);

            await advanceTime(provider, MATURATION);
            await advanceBlock(provider);
            await stakingPool.cycleStakeMaturation(); // makes a maturation cycle update

            await mockStaking.mock.getMaturingBalance.returns(stakedValue);
            await advanceTime(provider, MATURATION);
            await advanceBlock(provider);
            await stakingPool.cycleStakeMaturation(); // makes a maturation cycle update

            await mockStaking.mock.getReleasingBalance.returns(
                stakingReleasingBalance
            ); //fake as if there is something there
            await mockStaking.mock.getReleasingTimestamp.returns(0);
            await stakingPool.unstakeCTSI(stakedValue);

            await mockStaking.mock.unstake.withArgs(stakedValue).returns();
            await mockStaking.mock.withdraw
                .withArgs(stakingReleasingBalance)
                .returns();
            await stakingPool.cycleWithdrawRelease(); // force a release cycle update
            await mockStaking.mock.withdraw.withArgs(stakedValue).returns();
            await stakingPool.cycleWithdrawRelease(); // force a release cycle update

            await mockToken.mock.transfer
                .withArgs(signerAddress, stakedValue)
                .returns(true);
            let tx = stakingPool["withdraw()"]();

            await expect(tx).to.not.be.reverted;

            expect(await stakingPool.currentUnstakeEpoch()).to.be.equal(2);
            expect(
                await stakingPool.getReleasingBalance(signerAddress)
            ).to.be.equal(0);
        });
    });

    describe("User token states transitions", async () => {
        it("should lock balance correctly with matured balance", async () => {
            // First we lock the balance and make it matured
            // Then we lock the some more balance and check both balance types
            // Finally we mature it again and the resulting mature balance is the sum

            const stakedValue = 100;
            const stakingValue = 50;

            await mockToken.mock.transferFrom.returns(true);
            await mockToken.mock.approve.returns(true);
            await mockStaking.mock.stake.returns();
            await mockStaking.mock.getMaturingBalance.returns(0);
            await mockStaking.mock.getMaturingTimestamp.returns(
                stakingMaturingTimestamp
            );
            let tx = stakingPool.stake(stakedValue);

            await expect(tx).to.emit(stakingPool, "Stake");

            await advanceTime(provider, MATURATION);
            await stakingPool.cycleStakeMaturation(); // makes a maturation cycle update

            await advanceTime(provider, MATURATION);
            await stakingPool.cycleStakeMaturation(); // makes a maturation cycle update

            await stakingPool.stake(stakingValue);

            await mockStaking.mock.getMaturingTimestamp.returns(
                stakingMaturingTimestamp + 2 * MATURATION // corrects for advanceTime
            );

            expect(
                await stakingPool.getMaturingBalance(signerAddress)
            ).to.equal(stakingValue);

            expect(await stakingPool.getStakedBalance(signerAddress)).to.equal(
                stakedValue
            );

            expect(
                await stakingPool.getMaturingTimestamp(signerAddress)
            ).to.equal(stakingMaturingTimestamp + 3 * MATURATION);

            await advanceTime(provider, MATURATION);
            tx = stakingPool.cycleStakeMaturation(); // makes a maturation cycle update

            await mockStaking.mock.getMaturingTimestamp.returns(
                stakingMaturingTimestamp + 3 * MATURATION // corrects for advanceTime
            );

            expect(
                await stakingPool.getMaturingBalance(signerAddress)
            ).to.equal(stakingValue);

            expect(await stakingPool.getStakedBalance(signerAddress)).to.equal(
                stakedValue
            );

            expect(
                await stakingPool.getMaturingTimestamp(signerAddress)
            ).to.equal(stakingMaturingTimestamp + 3 * MATURATION);

            await advanceTime(provider, MATURATION);
            await stakingPool.cycleStakeMaturation(); // makes a maturation cycle update

            expect(
                await stakingPool.getMaturingBalance(signerAddress)
            ).to.equal(0);

            expect(
                await stakingPool.getMaturingTimestamp(signerAddress)
            ).to.equal(0);

            expect(await stakingPool.getStakedBalance(signerAddress)).to.equal(
                stakedValue + stakingValue
            );
        });

        it("should change staked balance right away when unstaking requested", async () => {
            // First we lock the balance and make it matured
            // Then we call unstake
            // Final matured balance is unaltered, releasing balance is equal to unstake call.

            const stakedValue = 100;

            await mockToken.mock.transferFrom.returns(true);
            await mockToken.mock.approve.returns(true);
            await mockStaking.mock.stake.returns();
            await mockStaking.mock.getMaturingBalance.returns(0);
            await mockStaking.mock.getMaturingTimestamp.returns(
                stakingMaturingTimestamp
            );
            await stakingPool.stake(stakedValue);

            await advanceTime(provider, MATURATION);
            await advanceBlock(provider);
            await stakingPool.cycleStakeMaturation(); // makes a maturation cycle update

            await advanceTime(provider, MATURATION);
            await advanceBlock(provider);
            await stakingPool.cycleStakeMaturation(); // makes a maturation cycle update

            const release = 0 + RELEASE;

            await mockStaking.mock.getReleasingBalance.returns(10); //fake as if there is something there
            await mockStaking.mock.getReleasingTimestamp.returns(0);
            await stakingPool.unstakeCTSI(stakedValue);
            expect(
                await stakingPool.getReleasingTimestamp(signerAddress)
            ).to.be.equal(release);
            expect(
                await stakingPool.getReleasingBalance(signerAddress)
            ).to.be.equal(stakedValue);
            expect(await stakingPool.getStakedBalance(signerAddress)).to.equal(
                0
            );
        });

        it("should change staked balance when unstaking requested and processed", async () => {
            // First we lock the balance and make it matured
            // Then we call unstake
            // Final matured balance is zero, releasing balance is equal to unstake call.
            const stakedValue = 100;

            await mockToken.mock.transferFrom.returns(true);
            await mockToken.mock.approve.returns(true);
            await mockStaking.mock.stake.returns();
            await mockStaking.mock.getMaturingBalance.returns(0);
            await mockStaking.mock.getMaturingTimestamp.returns(
                stakingMaturingTimestamp
            );
            await stakingPool.stake(stakedValue);

            await advanceTime(provider, MATURATION);
            await advanceBlock(provider);
            await stakingPool.cycleStakeMaturation(); // makes a maturation cycle update

            await advanceTime(provider, MATURATION);
            await advanceBlock(provider);
            await stakingPool.cycleStakeMaturation(); // makes a maturation cycle update

            await mockStaking.mock.getReleasingBalance.returns(10); //fake as if there is something there
            await mockStaking.mock.getReleasingTimestamp.returns(0);
            await stakingPool["unstake()"]();

            await mockStaking.mock.unstake.returns();
            await mockStaking.mock.getReleasingBalance.returns(0); // avoid having a staking.withdraw() call at this time
            await stakingPool.cycleWithdrawRelease(); // force a release cycle update

            expect(await stakingPool.totalStakedShares()).to.equal(0);
            expect(await stakingPool.getStakedBalance(signerAddress)).to.equal(
                0
            );
        });
    });

    describe("Reward token states transitions", async () => {
        // @TODO this last piece hasnt been coded cause a few things are still not 100% clear
        //  need more developed code to understand how it's going to work, but I thought to be
        //  important to register here the cases that we need covered.
        // @TODO need helper functions on StakingPoolImpl (getters) for reward related info
        it("should lock reward balance into staking queue", async () => {
            // First we make sure there is some stake active at the pool
            // Then we check the result for produceBlock
            const stakedValue = 100;
            const reward = 200;
            const commission = reward * 0.1; // 10%

            await mockToken.mock.transferFrom.returns(true);
            await mockToken.mock.approve.returns(true);
            await mockStaking.mock.stake.returns();
            await mockStaking.mock.getMaturingBalance.returns(0);
            await mockStaking.mock.getMaturingTimestamp.returns(0);
            await stakingPool.stake(stakedValue);
            await stakingPool.cycleStakeMaturation(); // makes a maturation cycle update
            await stakingPool.cycleStakeMaturation(); // makes a maturation cycle update

            await mockPoS.mock.getRewardManagerAddress.returns(
                mockRewardManager.address
            );
            await mockRewardManager.mock.getCurrentReward.returns(reward);
            await mockStaking.mock.getMaturingTimestamp.returns(
                Math.trunc(Date.now() / 1000) - 1000
            );
            await mockPoS.mock.produceBlock.returns(true);
            await mockFee.mock.getCommission.returns(commission);
            await mockToken.mock.approve.returns(true);
            await mockStaking.mock.stake.returns();
            await mockStaking.mock.getReleasingBalance.returns(0);

            await expect(stakingPool.produceBlock(0))
                .to.emit(stakingPool, "BlockProduced")
                .withArgs(reward, commission, reward - commission);

            expect(await stakingPool.currentStakeEpoch()).to.equal(3);
            expect(await stakingPool.rewardMaturing()).to.equal(reward * 0.9);
            expect(await stakingPool.currentMaturingTotal()).to.equal(reward);
        });

        it("should have staking queued reward be staked after 1 time window", async () => {
            // First we make sure there is some stake active at the pool
            // Then we check the result for produceBlock
            const stakedValue = 100;
            const reward = 200;
            const commission = reward * 0.1; // 10%

            await mockToken.mock.transferFrom.returns(true);
            await mockToken.mock.approve.returns(true);
            await mockStaking.mock.stake.returns();
            await mockStaking.mock.getMaturingBalance.returns(0);
            await mockStaking.mock.getMaturingTimestamp.returns(0);
            await stakingPool.stake(stakedValue);
            await stakingPool.cycleStakeMaturation(); // makes a maturation cycle update
            await stakingPool.cycleStakeMaturation(); // makes a maturation cycle update

            await mockPoS.mock.getRewardManagerAddress.returns(
                mockRewardManager.address
            );
            await mockRewardManager.mock.getCurrentReward.returns(reward);
            await mockStaking.mock.getMaturingTimestamp.returns(
                stakingMaturingTimestamp
            );
            await mockPoS.mock.produceBlock.returns(true);
            await mockFee.mock.getCommission.returns(commission);
            await mockStaking.mock.getReleasingBalance.returns(0);

            await mockStaking.mock.getMaturingBalance.returns(stakedValue);
            await expect(stakingPool.produceBlock(0))
                .to.emit(stakingPool, "BlockProduced")
                .withArgs(reward, commission, reward - commission);

            expect(await stakingPool.currentStakeEpoch()).to.equal(2);
            expect(await stakingPool.rewardQueued()).to.equal(reward * 0.9);
            expect(await stakingPool.currentMaturingTotal()).to.equal(0);
            expect(await stakingPool.currentQueuedTotal()).to.equal(
                reward * 0.1
            );

            await mockStaking.mock.getMaturingTimestamp.returns(0);
            await mockStaking.mock.stake.returns();
            await mockToken.mock.approve.returns(true);
            await stakingPool.cycleStakeMaturation();

            expect(await stakingPool.currentStakeEpoch()).to.equal(3);
            expect(await stakingPool.rewardMaturing()).to.equal(reward * 0.9);
            expect(await stakingPool.rewardQueued()).to.equal(0);
            expect(await stakingPool.currentMaturingTotal()).to.equal(reward);
            expect(await stakingPool.currentQueuedTotal()).to.equal(0);
        });

        it("should have reward be matured after 2 time windows", async () => {
            // setup a user with a matured balance
            // call produceBlock()
            // advanceTime and mature previous queue
            // final total staked balance is added by reward total

            // Get some staked balance mature
            const stakedValue = ethers.utils.parseEther("100");

            await mockToken.mock.transferFrom.returns(true);
            await mockToken.mock.approve.returns(true);
            await mockStaking.mock.stake.returns();
            await mockStaking.mock.getMaturingBalance.returns(0);

            await mockStaking.mock.getMaturingTimestamp.returns(
                stakingMaturingTimestamp
            );
            let tx = await stakingPool.stake(stakedValue);

            await advanceTime(provider, MATURATION);
            await advanceBlock(provider);
            tx = await stakingPool.cycleStakeMaturation(); // makes a maturation cycle update

            await advanceTime(provider, MATURATION);
            await advanceBlock(provider);
            tx = await stakingPool.cycleStakeMaturation(); // makes a maturation cycle update

            const reward = ethers.utils.parseEther("200");
            const commission = reward.div(10); // 10%
            // Update the next cycle of maturation timestamp
            stakingMaturingTimestamp =
                stakingMaturingTimestamp + 2 * MATURATION;
            await mockStaking.mock.getMaturingTimestamp.returns(
                stakingMaturingTimestamp
            );

            await mockPoS.mock.getRewardManagerAddress.returns(
                mockRewardManager.address
            );
            await mockRewardManager.mock.getCurrentReward.returns(reward);
            await mockPoS.mock.produceBlock.returns(true);
            await mockFee.mock.getCommission.returns(commission);
            await mockStaking.mock.getReleasingBalance.returns(0);

            await expect(stakingPool.produceBlock(0))
                .to.emit(stakingPool, "BlockProduced")
                .withArgs(reward, commission, reward.sub(commission));

            await advanceTime(provider, MATURATION);
            await advanceBlock(provider);
            await mockToken.mock.approve.returns(false); // undo inconditional pass
            await mockToken.mock.approve
                .withArgs(mockStaking.address, reward)
                .returns(true); // only pass with the right value
            tx = await stakingPool.cycleStakeMaturation(); // makes a maturation cycle update

            await advanceTime(provider, MATURATION);
            await advanceBlock(provider);
            await mockToken.mock.approve
                .withArgs(mockStaking.address, 0)
                .returns(true);
            tx = await stakingPool.cycleStakeMaturation(); // makes a maturation cycle update

            // maturing balance should be zero, and moved to mature
            expect(
                await stakingPool.getMaturingBalance(signerAddress)
            ).to.be.equal(0);

            // amount should be mature at this point
            errorCheck(
                await stakingPool.getStakedBalance(signerAddress),
                reward.mul(9).div(10).add(stakedValue)
            );
            errorCheck(
                await stakingPool.getStakedBalance(poolManagerAddress),
                reward.div(10)
            );
        });

        it("should distribute reward correctly among users", async () => {
            // setup 3 users with different matured balances and staking+releasing balances
            // call produceBlock()
            // user's balance reproduce the correct proportion of their initial share added by reward

            // @TODO We are missing a releasing balance

            // Get some staked balance mature
            const signerStakedValue = ethers.utils.parseEther("100");
            const secSignerStakedValue = ethers.utils.parseEther("200");
            const thirdSignerMaturingValue = ethers.utils.parseEther("300");

            await mockToken.mock.transferFrom.returns(true);
            await mockToken.mock.approve.returns(true);
            await mockStaking.mock.stake.returns();
            await mockStaking.mock.getMaturingBalance.returns(0);
            await mockStaking.mock.getMaturingTimestamp.returns(
                stakingMaturingTimestamp
            );
            let tx = await stakingPool.stake(signerStakedValue);
            tx = await stakingPool
                .connect(secSigner)
                .stake(secSignerStakedValue);

            await advanceTime(provider, MATURATION);
            await advanceBlock(provider);
            tx = await stakingPool.cycleStakeMaturation(); // makes a maturation cycle update

            // stake 3rd signer so they have a maturing balance when reward comes
            tx = await stakingPool
                .connect(thirdSigner)
                .stake(thirdSignerMaturingValue);

            await advanceTime(provider, MATURATION);
            await advanceBlock(provider);
            tx = await stakingPool.cycleStakeMaturation(); // makes a maturation cycle update

            const reward = ethers.utils.parseEther("200");
            const commission = reward.div(10); // 10%
            // Update the next cycle of maturation timestamp
            stakingMaturingTimestamp =
                stakingMaturingTimestamp + 2 * MATURATION;
            await mockStaking.mock.getMaturingTimestamp.returns(
                stakingMaturingTimestamp
            );

            await mockPoS.mock.getRewardManagerAddress.returns(
                mockRewardManager.address
            );
            await mockRewardManager.mock.getCurrentReward.returns(reward);
            await mockPoS.mock.produceBlock.returns(true);
            await mockFee.mock.getCommission.returns(commission);
            await mockStaking.mock.getMaturingBalance.returns(
                thirdSignerMaturingValue
            );
            await mockStaking.mock.getReleasingBalance.returns(0);

            await expect(stakingPool.produceBlock(0))
                .to.emit(stakingPool, "BlockProduced")
                .withArgs(reward, commission, reward.sub(commission));

            await advanceTime(provider, MATURATION);
            await advanceBlock(provider);
            await mockToken.mock.approve.returns(false); // undo inconditional pass
            await mockToken.mock.approve
                .withArgs(mockStaking.address, reward)
                .returns(true); // only pass with the right value
            tx = await stakingPool.cycleStakeMaturation(); // makes a maturation cycle update

            await advanceTime(provider, MATURATION);
            await advanceBlock(provider);
            await mockToken.mock.approve
                .withArgs(mockStaking.address, 0)
                .returns(true);
            tx = await stakingPool.cycleStakeMaturation(); // makes a maturation cycle update

            const poolManagerBalance = reward.div(10);
            const signerReward = reward.mul(9 * 1).div(10 * 3); // since it had 100 out of 300 staked; 1 parts of 3
            const secSignerReward = reward.mul(9 * 2).div(10 * 3); // since it had 200 out of 300 staked; 2 parts of 3

            errorCheck(
                await stakingPool.getStakedBalance(signerAddress),
                signerReward.add(signerStakedValue)
            );
            errorCheck(
                await stakingPool.getStakedBalance(secSignerAddress),
                secSignerStakedValue.add(secSignerReward)
            );
            errorCheck(
                await stakingPool.getStakedBalance(thirdSignerAddress),
                thirdSignerMaturingValue
            );
            errorCheck(
                await stakingPool.getStakedBalance(poolManagerAddress),
                poolManagerBalance
            );
        });
    });

    describe("Function tests", async () => {
        it("should emit Rewarded on produceBlock and save reward", async () => {
            // First we make sure there is some stake active at the pool
            // Then we check the result for produceBlock
            const stakedValue = 100;
            const reward = 200;
            const commission = reward * 0.1; // 10%

            await mockToken.mock.transferFrom.returns(true);
            await mockToken.mock.approve.returns(true);
            await mockStaking.mock.stake.returns();
            await mockStaking.mock.getMaturingBalance.returns(0);
            await mockStaking.mock.getMaturingTimestamp.returns(0);
            await stakingPool.stake(stakedValue);
            await stakingPool.cycleStakeMaturation(); // makes a maturation cycle update
            await stakingPool.cycleStakeMaturation(); // makes a maturation cycle update

            await mockPoS.mock.getRewardManagerAddress.returns(
                mockRewardManager.address
            );
            await mockRewardManager.mock.getCurrentReward.returns(reward);
            await mockStaking.mock.getMaturingTimestamp.returns(
                Date.now() + 1000
            );
            await mockPoS.mock.produceBlock.returns(true);
            await mockFee.mock.getCommission.returns(commission);
            await mockStaking.mock.getReleasingBalance.returns(0);
            await expect(stakingPool.produceBlock(0))
                .to.emit(stakingPool, "BlockProduced")
                .withArgs(reward, commission, reward - commission);

            expect(await stakingPool.currentStakeEpoch()).to.equal(3);

            expect(await stakingPool.rewardQueued()).to.equal(0);
            expect(await stakingPool.rewardMaturing()).to.equal(reward * 0.9);
        });

        it("should emit Stake on stake() and update balance for user", async () => {
            const stakeBalance = 100;
            const remainingTimeOnMaturingState = Date.now() + 100;

            await mockToken.mock.transferFrom.returns(true);
            await mockStaking.mock.getMaturingBalance.returns(0);
            await mockStaking.mock.getMaturingTimestamp.returns(
                remainingTimeOnMaturingState
            );
            const tx = stakingPool.stake(stakeBalance);

            await expect(tx)
                .to.emit(stakingPool, "Stake")
                .withArgs(
                    signerAddress,
                    stakeBalance,
                    remainingTimeOnMaturingState + MATURATION
                );
            const balances = await stakingPool.userBalance(signerAddress);
            expect(balances.stakingVoucher.amountQueued).to.equal(stakeBalance);

            expect(await stakingPool.currentQueuedTotal()).to.equal(
                stakeBalance
            );
        });

        it("should update global balance states on cycleStakeMaturation", async () => {
            // This also collaterally tests that stake is cycling the user balance
            const lockedBalance = 100;
            const maturingBalance = 200;
            const stakedBalance = 400;

            const maturingTimestamp = Date.now();

            // setup first locked state
            await mockToken.mock.transferFrom.returns(true);
            await mockStaking.mock.getMaturingBalance.returns(0);
            await mockStaking.mock.getMaturingTimestamp.returns(
                maturingTimestamp
            );
            let tx = await stakingPool.stake(stakedBalance);

            let balances = await stakingPool.userBalance(signerAddress);
            expect(balances.stakingVoucher.amountQueued).to.equal(
                stakedBalance
            );
            expect(balances.stakingVoucher.amountStaked).to.equal(0);
            expect(balances.stakedPoolShares).to.equal(0);

            // First cycling
            await mockStaking.mock.getMaturingTimestamp.returns(0);
            await mockStaking.mock.stake.returns();
            await mockToken.mock.approve.returns(true);
            await stakingPool.cycleStakeMaturation();

            // cycleStakeMaturation checks
            expect(await stakingPool.currentStakeEpoch()).to.equal(1);
            expect(await stakingPool.currentQueuedTotal()).to.equal(0);
            expect(await stakingPool.totalStaked()).to.equal(0);
            expect(await stakingPool.currentMaturingTotal()).to.equal(
                stakedBalance
            );
            await expect(stakingPool.stakingVoucherValueAtEpoch(0)).to.be
                .reverted;

            // setup second locked state
            await mockToken.mock.transferFrom.returns(true);
            await mockStaking.mock.getMaturingTimestamp.returns(
                maturingTimestamp
            );
            tx = await stakingPool.stake(maturingBalance);

            balances = await stakingPool.userBalance(signerAddress);
            expect(balances.stakingVoucher.amountQueued).to.equal(
                maturingBalance
            );
            expect(balances.stakingVoucher.amountStaked).to.equal(
                stakedBalance
            );
            expect(balances.stakedPoolShares).to.equal(0);

            // Second cycling
            await mockStaking.mock.getMaturingTimestamp.returns(0);
            await mockStaking.mock.stake.returns();
            await mockToken.mock.approve.returns(true);
            await stakingPool.cycleStakeMaturation();

            // cycleStakeMaturation checks
            expect(await stakingPool.currentStakeEpoch()).to.equal(2);
            expect(await stakingPool.currentQueuedTotal()).to.equal(0);
            expect(await stakingPool.totalStaked()).to.equal(stakedBalance);
            expect(await stakingPool.currentMaturingTotal()).to.equal(
                maturingBalance
            );
            expect(await stakingPool.stakingVoucherValueAtEpoch(0)).to.equal(
                FIXED_POINT_DECIMALS
            );

            // setup third locked state
            await mockToken.mock.transferFrom.returns(true);
            await mockStaking.mock.getMaturingTimestamp.returns(
                maturingTimestamp
            );
            tx = await stakingPool.stake(lockedBalance);

            balances = await stakingPool.userBalance(signerAddress);
            expect(balances.stakingVoucher.amountQueued).to.equal(
                lockedBalance
            );
            expect(balances.stakingVoucher.amountStaked).to.equal(
                maturingBalance
            );
            expect(balances.stakedPoolShares).to.equal(
                stakedBalance * FIXED_POINT_DECIMALS
            );

            // third cycling
            await mockStaking.mock.getMaturingTimestamp.returns(0);
            await mockStaking.mock.stake.returns();
            await mockToken.mock.approve.returns(true);
            await stakingPool.cycleStakeMaturation();

            // cycleStakeMaturation checks
            expect(await stakingPool.currentStakeEpoch()).to.equal(3);
            expect(await stakingPool.currentQueuedTotal()).to.equal(0);
            expect(await stakingPool.totalStaked()).to.equal(
                stakedBalance + maturingBalance
            );
            expect(await stakingPool.currentMaturingTotal()).to.equal(
                lockedBalance
            );
            expect(await stakingPool.stakingVoucherValueAtEpoch(0)).to.equal(
                FIXED_POINT_DECIMALS
            );
            expect(await stakingPool.stakingVoucherValueAtEpoch(1)).to.equal(
                FIXED_POINT_DECIMALS
            );

            // force one more user balance update
            await mockToken.mock.transferFrom.returns(true);
            await mockStaking.mock.getMaturingTimestamp.returns(
                maturingTimestamp
            );
            tx = await stakingPool.stake(0);

            balances = await stakingPool.userBalance(signerAddress);
            expect(balances.stakingVoucher.amountQueued).to.equal(0);
            expect(balances.stakingVoucher.amountStaked).to.equal(
                lockedBalance
            );
            expect(balances.stakedPoolShares).to.equal(
                (maturingBalance + stakedBalance) * FIXED_POINT_DECIMALS
            );
        });

        it("should not revert on call to getReleasingBalance when no unstake request", async () => {
            const tx = stakingPool.getReleasingBalance(signerAddress);
            await expect(tx).to.be.not.reverted;
        });

        it("should not revert on call to getStakedBalance when no stake request", async () => {
            await mockStaking.mock.getMaturingTimestamp.returns(
                stakingMaturingTimestamp
            );
            const tx = stakingPool.getStakedBalance(signerAddress);
            await expect(tx).to.not.be.reverted;
        });

        it("should not revert on call to getStakedBalance with one cycle", async () => {
            const stakedBalance = 400;
            // setup first locked state
            await mockToken.mock.transferFrom.returns(true);
            await mockStaking.mock.getMaturingBalance.returns(0);
            await mockStaking.mock.getMaturingTimestamp.returns(Date.now());
            await stakingPool.stake(stakedBalance);
            // // First cycling
            await mockStaking.mock.getMaturingTimestamp.returns(0);
            await mockStaking.mock.stake.returns();
            await mockToken.mock.approve.returns(true);
            await stakingPool.cycleStakeMaturation();

            const tr = stakingPool.getStakedBalance(signerAddress);
            await expect(tr).to.not.be.reverted;
        });

        it("should not revert on cycleStakeMaturation with no lockedValue", async () => {
            const stakedBalance = 400;

            // setup first locked state
            await mockToken.mock.transferFrom.returns(true);
            await mockStaking.mock.getMaturingBalance.returns(0);
            await mockStaking.mock.getMaturingTimestamp.returns(Date.now());
            await stakingPool.stake(stakedBalance);
            // First cycling
            await mockStaking.mock.getMaturingTimestamp.returns(0);
            await mockStaking.mock.stake.returns();
            await mockToken.mock.approve.returns(true);
            await stakingPool.cycleStakeMaturation();

            // no new stakes happening
            // second cycling
            await mockStaking.mock.getMaturingTimestamp.returns(0);
            await mockStaking.mock.stake.returns();
            await mockToken.mock.approve.returns(true);
            const tx = stakingPool.cycleStakeMaturation();
            await expect(tx).to.not.be.reverted;
        });

        it("should have right states for canCycleStakeMaturation", async () => {
            const stakedBalance = 400;
            // setup queued stake amount
            await mockToken.mock.transferFrom.returns(true);
            await mockStaking.mock.getMaturingTimestamp.returns(Date.now());
            await stakingPool.stake(stakedBalance);

            // First state
            await mockStaking.mock.getMaturingTimestamp.returns(0);
            let [available, currentQueuedTotal, currentMaturingTotal] =
                await stakingPool.canCycleStakeMaturation();
            expect(available).to.be.true;
            expect(currentQueuedTotal).to.be.equal(stakedBalance);
            expect(currentMaturingTotal).to.be.equal(0);

            // Second state
            await mockStaking.mock.getMaturingTimestamp.returns(
                stakingMaturingTimestamp
            );
            [available, currentQueuedTotal, currentMaturingTotal] =
                await stakingPool.canCycleStakeMaturation();
            expect(available).to.be.false;
            expect(currentQueuedTotal).to.be.equal(stakedBalance);
            expect(currentMaturingTotal).to.be.equal(0);
        });

        it("should have right states for canCycleWithdrawRelease", async () => {
            const stakedValue = 100;
            const stakingReleasingBalance = 10;

            await mockToken.mock.transferFrom.returns(true);
            await mockToken.mock.approve.returns(true);
            await mockStaking.mock.stake.returns();
            await mockStaking.mock.getMaturingBalance.returns(0);
            await mockStaking.mock.getMaturingTimestamp.returns(
                stakingMaturingTimestamp
            );
            await stakingPool.stake(stakedValue);

            await advanceTime(provider, MATURATION);
            await advanceBlock(provider);
            await stakingPool.cycleStakeMaturation(); // makes a maturation cycle update

            await advanceTime(provider, MATURATION);
            await advanceBlock(provider);
            await stakingPool.cycleStakeMaturation(); // makes a maturation cycle update

            await mockStaking.mock.getReleasingBalance.returns(
                stakingReleasingBalance
            ); //fake as if there is something there
            await mockStaking.mock.getReleasingTimestamp.returns(0);
            await stakingPool.unstakeCTSI(stakedValue);
            await mockStaking.mock.withdraw
                .withArgs(stakingReleasingBalance)
                .returns();

            let [available, totalToUnstakeValue, totalUnstaking] =
                await stakingPool.canCycleWithdrawRelease();

            expect(available).to.be.true;
            expect(totalToUnstakeValue).to.be.equal(stakedValue);
            expect(totalUnstaking).to.be.equal(0);

            await mockStaking.mock.getReleasingTimestamp.returns(
                ethers.constants.MaxUint256
            );
            [available, totalToUnstakeValue, totalUnstaking] =
                await stakingPool.canCycleWithdrawRelease();
            expect(available).to.be.false;
            expect(totalToUnstakeValue).to.be.equal(stakedValue);
            expect(totalUnstaking).to.be.equal(0);

            await mockStaking.mock.getReleasingTimestamp.returns(0);
            await mockStaking.mock.unstake.returns();
            await stakingPool.cycleWithdrawRelease(); // force a release cycle update

            [available, totalToUnstakeValue, totalUnstaking] =
                await stakingPool.canCycleWithdrawRelease();

            expect(available).to.be.true;
            expect(totalToUnstakeValue).to.be.equal(0);
            expect(totalUnstaking).to.be.equal(stakedValue);

            await mockStaking.mock.getReleasingTimestamp.returns(
                ethers.constants.MaxUint256
            );
            [available, totalToUnstakeValue, totalUnstaking] =
                await stakingPool.canCycleWithdrawRelease();
            expect(available).to.be.false;
            expect(totalToUnstakeValue).to.be.equal(0);
            expect(totalUnstaking).to.be.equal(stakedValue);
        });

        it("should not unstake without shares", async () => {
            const stakedValue = 100;
            await mockStaking.mock.getMaturingBalance.returns(0);
            await mockStaking.mock.getReleasingBalance.returns(0);
            await expect(stakingPool["unstake()"]()).to.be.revertedWith(
                "Can not unstake 0 shares"
            );
        });

        it("should get correct getStakedBalance after getMaturingTimestamp passed", async () => {
            // when two call to cycleStakeMaturation should've been called but it wasn't
            // and the time has passed, to effectively display reality, getStakedBalance
            // should take the timestamp into account
            const firstStake = 100;
            const secStake = 200;

            await mockToken.mock.transferFrom.returns(true);
            await mockToken.mock.approve.returns(true);
            await mockStaking.mock.stake.returns();
            await mockStaking.mock.getMaturingBalance.returns(0);
            await mockStaking.mock.getMaturingTimestamp.returns(0);
            await stakingPool.stake(firstStake);
            await stakingPool.cycleStakeMaturation();
            await stakingPool.stake(secStake);

            expect(await stakingPool.currentStakeEpoch()).to.be.equal(1);
            expect(await stakingPool.totalStaked()).to.be.equal(0);
            expect(
                await stakingPool.getStakedBalance(signerAddress)
            ).to.be.equal(firstStake);
        });

        it("should get correct staked balance after update", async () => {
            // @dev regression test
            // after calling `stake()` once, and cycling once, a call to `unstake()`
            // would allow for _updateUserBalances() to update the balances without updating the
            // stakingVoucher.queueEpoch, putting it in a broken state

            const firstStake = 100;
            const secStake = 200;
            const unstakeAmount = 50;

            await mockToken.mock.transferFrom.returns(true);
            await mockToken.mock.approve.returns(true);
            await mockStaking.mock.stake.returns();
            await mockStaking.mock.getMaturingBalance.returns(0);
            await mockStaking.mock.getMaturingTimestamp.returns(0);
            await stakingPool.stake(firstStake);
            await stakingPool.cycleStakeMaturation();
            await stakingPool.cycleStakeMaturation();

            expect(await stakingPool.currentStakeEpoch()).to.be.equal(2);
            expect(await stakingPool.totalStaked()).to.be.equal(firstStake);
            expect(
                await stakingPool.getStakedBalance(signerAddress)
            ).to.be.equal(firstStake);

            // next 2 calls will make sure we have the user with 'StakingVoucher.amountStaked' virtually
            await stakingPool.stake(secStake);
            await stakingPool.cycleStakeMaturation();

            // now we unstake some so UserBalance can be updated
            await mockStaking.mock.getReleasingBalance.returns(0);
            await stakingPool.unstakeCTSI(unstakeAmount);
            await mockStaking.mock.getMaturingTimestamp.returns(
                stakingMaturingTimestamp
            );
            expect(await stakingPool.getStakedBalance(signerAddress)).to.equal(
                firstStake - unstakeAmount
            );

            const userBalance = await stakingPool.userBalance(signerAddress);
            expect({
                stakedPoolShares: userBalance.stakedPoolShares.toNumber(),
                amountQueued:
                    userBalance.stakingVoucher.amountQueued.toNumber(),
                amountStaked:
                    userBalance.stakingVoucher.amountStaked.toNumber(),
                queueEpoch: userBalance.stakingVoucher.queueEpoch.toNumber(),
            }).to.be.deep.equal({
                stakedPoolShares:
                    (firstStake - unstakeAmount) * FIXED_POINT_DECIMALS,
                amountQueued: 0,
                amountStaked: secStake,
                queueEpoch: 3,
            });
        });

        it("should produceBlock correctly before 2nd cycleStakeMaturation called", async () => {
            //@dev regression test
            // there is a corner case found on testnet where
            // it's possible to be elected to produce a block just before
            // being able to call cycleStakeMaturation and update the global states

            /// two users, different status of maturations
            const [aliceSigner, aliceAddress] = [secSigner, secSignerAddress];
            const [bobSigner, bobAddress] = [thirdSigner, thirdSignerAddress];
            const aliceStakedValue = ethers.utils.parseEther("2000");
            const bobStakedValue = ethers.utils.parseEther("1000");
            const bobStakingValue = ethers.utils.parseEther("500");
            const reward = ethers.utils.parseEther("200");
            const commission = reward.div(10);

            await mockToken.mock.transferFrom.returns(true);
            await mockToken.mock.approve.returns(true);
            await mockStaking.mock.stake.returns();
            await mockStaking.mock.getMaturingBalance.returns(0);
            await mockStaking.mock.getMaturingTimestamp.returns(0); // anytime we call cycleStakeMaturation it will pass

            await stakingPool.connect(aliceSigner).stake(aliceStakedValue);
            await stakingPool.connect(bobSigner).stake(bobStakedValue);

            await stakingPool.cycleStakeMaturation(); // makes a maturation cycle update
            await stakingPool.cycleStakeMaturation(); // makes a maturation cycle update

            expect(await stakingPool.totalStaked()).to.be.equal(
                aliceStakedValue.add(bobStakedValue)
            ); // ensure all is properly staked

            /// get Bob to having some maturing balance that will be 'ready' when block is produced
            await stakingPool.connect(bobSigner).stake(bobStakingValue);
            await stakingPool.cycleStakeMaturation(); // now bobStakingValue is on 'StakingImpl'

            /// just before last maturation we call produceBlock
            await mockPoS.mock.getRewardManagerAddress.returns(
                mockRewardManager.address
            );
            await mockRewardManager.mock.getCurrentReward.returns(reward);
            await mockPoS.mock.produceBlock.returns(true);
            await mockFee.mock.getCommission.returns(commission);
            await mockStaking.mock.stake.withArgs(reward).returns();
            await mockStaking.mock.getReleasingBalance.returns(0);

            await expect(stakingPool.produceBlock(0))
                .to.emit(stakingPool, "BlockProduced")
                .withArgs(reward, commission, reward.sub(commission));

            /// check for all user and global states for correct values
            const totalStaked = aliceStakedValue
                .add(bobStakedValue)
                .add(bobStakingValue);
            expect(await stakingPool.totalStaked()).to.be.equal(totalStaked);
            expect(await stakingPool.currentMaturingTotal()).to.be.equal(
                reward
            );
            expect(await stakingPool.currentQueuedTotal()).to.be.equal(0);
            const aliceShare = reward
                .sub(commission)
                .mul(aliceStakedValue)
                .div(totalStaked);
            const bobShare = reward
                .sub(commission)
                .mul(bobStakedValue.add(bobStakingValue))
                .div(totalStaked);
            expect(
                await stakingPool.getStakedBalance(aliceAddress)
            ).to.be.equal(aliceStakedValue.add(aliceShare));
            expect(await stakingPool.getStakedBalance(bobAddress)).to.be.equal(
                bobStakedValue.add(bobStakingValue).add(bobShare)
            );
            await mockStaking.mock.getMaturingTimestamp.returns(
                ethers.constants.MaxUint256
            );
            expect(
                await stakingPool.getMaturingBalance(poolManagerAddress)
            ).to.be.equal(commission);
        });
    });
});
