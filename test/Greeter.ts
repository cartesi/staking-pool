// Copyright 2021 Cartesi Pte. Ltd.

// Licensed under the Apache License, Version 2.0 (the "License"); you may not
// use this file except in compliance with the License. You may obtain a copy
// of the license at http://www.apache.org/licenses/LICENSE-2.0

// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS, WITHOUT
// WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the
// License for the specific language governing permissions and limitations
// under the License.

import { expect, use } from "chai";
import { ethers } from "hardhat";
import { solidity } from "ethereum-waffle";

use(solidity);

describe("Greeter", function () {
    it("Should return the new greeting once it's changed", async function () {
        const Greeter = await ethers.getContractFactory("Greeter");
        const greeter = await Greeter.deploy("Hello, world!");

        await greeter.deployed();
        expect(await greeter.greet()).to.equal("Hello, world!");

        await greeter.setGreeting("Hola, mundo!");
        expect(await greeter.greet()).to.equal("Hola, mundo!");
    });
});
