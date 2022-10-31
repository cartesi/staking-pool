// Copyright 2021 Cartesi Pte. Ltd.

// Licensed under the Apache License, Version 2.0 (the "License"); you may not use
// this file except in compliance with the License. You may obtain a copy of the
// License at http://www.apache.org/licenses/LICENSE-2.0

// Unless required by applicable law or agreed to in writing, software distributed
// under the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR
// CONDITIONS OF ANY KIND, either express or implied. See the License for the
// specific language governing permissions and limitations under the License.

import { expect, use } from "chai";
import { waffle, ethers, network } from "hardhat";

import { setNextBlockTimestamp, setupPool, parseCTSI } from "./utils";
import { ENS__factory, ReverseRegistrar__factory } from "../src/types";

import Resolver from "@ensdomains/resolver/build/contracts/Resolver.json";
const { solidity } = waffle;

use(solidity);
const MINUTE = 60; // seconds in a minute
const HOUR = 60 * MINUTE; // seconds in an hour
const STAKE_LOCK = 60; // seconds
const timeToStake = 2 * MINUTE;
const timeToRelease = 2 * MINUTE;
const ADDR_REVERSE_NODE =
    "0x91d1777781884d03a6757a803996e38de2a42967fb37eeaca72729271025a9e2";

describe("StakingPoolManagement", async () => {
    it("should start unpaused", async () => {
        const {
            owner: { pool },
        } = await setupPool({ stakeLock: STAKE_LOCK });

        expect(await pool.paused()).to.be.false;
    });

    it("should pause", async () => {
        const { owner } = await setupPool({ stakeLock: STAKE_LOCK });
        const { pool } = owner;
        await expect(pool.pause())
            .to.emit(pool, "Paused")
            .withArgs(owner.address);
        expect(await pool.paused()).to.be.true;
    });

    it("should not pause if not owner", async () => {
        const { alice } = await setupPool({ stakeLock: STAKE_LOCK });
        await expect(alice.pool.pause()).to.revertedWith(
            "Ownable: caller is not the owner"
        );
    });

    it("should unpause", async () => {
        const { owner } = await setupPool({ stakeLock: STAKE_LOCK });
        const { pool } = owner;
        await pool.pause();

        await expect(pool.unpause())
            .to.emit(pool, "Unpaused")
            .withArgs(owner.address);

        expect(await pool.paused()).to.be.false;
    });

    it("should setName", async () => {
        const { owner } = await setupPool({ stakeLock: STAKE_LOCK });
        const { pool } = owner;
        const ensAddr = await pool.ens();
        const ens = ENS__factory.connect(ensAddr, pool.provider);
        const reverseReg = ReverseRegistrar__factory.connect(
            await ens.owner(ADDR_REVERSE_NODE),
            pool.provider
        );

        const name = "reallyGoodPool";

        await expect(pool.setName(name))
            .to.emit(ens, "NewOwner")
            .to.emit(ens, "NewResolver")
            .to.emit(pool, "StakingPoolRenamed")
            .withArgs(name);

        const defaultResolverAddr = await reverseReg.defaultResolver();
        const node = await reverseReg.node(pool.address);

        const resolver = new ethers.Contract(
            defaultResolverAddr,
            Resolver.abi,
            pool.provider
        );
        expect(await resolver.name(node)).to.be.equal(name);
    });

    it("should not setName if not owner", async () => {
        const { alice } = await setupPool({ stakeLock: STAKE_LOCK });
        await expect(alice.pool.setName("something")).to.revertedWith(
            "Ownable: caller is not the owner"
        );
    });
});
