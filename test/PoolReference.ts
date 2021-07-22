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

import { StakingPoolImpl__factory } from "../src/types/factories/StakingPoolImpl__factory";
import { StakingPoolImpl } from "../src/types/StakingPoolImpl";

const { solidity } = waffle;

use(solidity);

describe("StakingPoolImpl Reference", async () => {
    let reference: StakingPoolImpl;

    before(async () => {
        const [deployer] = await ethers.getSigners();
        await deployments.fixture();
        const { StakingPoolImpl } = await deployments.all();
        reference = StakingPoolImpl__factory.connect(
            StakingPoolImpl.address,
            deployer
        );
    });

    it("should have correct defaults", async () => {
        expect(await reference.paused()).to.be.true;
        expect(await reference.owner()).to.be.equal(
            ethers.constants.AddressZero
        );
    });
});
