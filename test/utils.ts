// Copyright 2021 Cartesi Pte. Ltd.

// Licensed under the Apache License, Version 2.0 (the "License"); you may not use
// this file except in compliance with the License. You may obtain a copy of the
// License at http://www.apache.org/licenses/LICENSE-2.0

// Unless required by applicable law or agreed to in writing, software distributed
// under the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR
// CONDITIONS OF ANY KIND, either express or implied. See the License for the
// specific language governing permissions and limitations under the License.

import { use } from "chai";
import { solidity } from "ethereum-waffle";
import { JsonRpcProvider } from "@ethersproject/providers";

use(solidity);

export const advanceTime = async (
    provider: JsonRpcProvider,
    seconds: number
) => {
    await provider.send("evm_increaseTime", [seconds]);
};

export const advanceBlock = async (provider: JsonRpcProvider) => {
    await provider.send("evm_mine", []);
};

export const setNextBlockTimestamp = async (
    provider: JsonRpcProvider,
    ts: number
) => {
    await provider.send("evm_setNextBlockTimestamp", [ts]);
};

export const advanceMultipleBlocks = async (
    provider: JsonRpcProvider,
    numOfBlocks: number
) => {
    for (let i = 0; i < numOfBlocks; i++) {
        await advanceBlock(provider);
    }
};
