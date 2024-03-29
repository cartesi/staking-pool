// Copyright 2021 Cartesi Pte. Ltd.

// Licensed under the Apache License, Version 2.0 (the "License"); you may not
// use this file except in compliance with the License. You may obtain a copy
// of the license at http://www.apache.org/licenses/LICENSE-2.0

// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS, WITHOUT
// WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the
// License for the specific language governing permissions and limitations
// under the License.

import { HardhatUserConfig } from "hardhat/config";
import { HttpNetworkUserConfig } from "hardhat/types";

import "@nomiclabs/hardhat-waffle";
import "@nomiclabs/hardhat-ethers";
import "@nomiclabs/hardhat-etherscan";
import "@typechain/hardhat";
import "hardhat-deploy";
import "solidity-coverage";
import "./src/tasks";

// read MNEMONIC from file or from env variable
let mnemonic = process.env.MNEMONIC;

const infuraNetwork = (
    network: string,
    chainId?: number,
    gas?: number
): HttpNetworkUserConfig => {
    return {
        url: `https://${network}.infura.io/v3/${process.env.PROJECT_ID}`,
        chainId,
        gas,
        accounts: mnemonic ? { mnemonic } : undefined,
    };
};

const config: HardhatUserConfig = {
    networks: {
        hardhat: mnemonic ? { accounts: { mnemonic } } : {},
        localhost: {
            url: "http://localhost:8545",
            accounts: mnemonic ? { mnemonic } : undefined,
        },
        mainnet: infuraNetwork("mainnet", 1, 6283185),
        goerli: infuraNetwork("goerli", 5, 6283185),
        sepolia: infuraNetwork("sepolia", 11155111, 6283185),
    },
    solidity: {
        compilers: [
            {
                version: "0.8.7",
                settings: {
                    optimizer: {
                        enabled: true,
                    },
                },
            },
        ],
    },
    paths: {
        artifacts: "artifacts",
        deploy: "deploy",
        deployments: "deployments",
    },
    external: {
        contracts: [
            {
                artifacts: "node_modules/@cartesi/token/export/artifacts",
                deploy: "node_modules/@cartesi/token/dist/deploy",
            },
            {
                artifacts: "node_modules/@cartesi/util/export/artifacts",
                deploy: "node_modules/@cartesi/util/dist/deploy",
            },
            {
                artifacts: "node_modules/@cartesi/tree/export/artifacts",
                deploy: "node_modules/@cartesi/tree/dist/deploy",
            },
            {
                artifacts: "node_modules/@cartesi/pos/export/artifacts",
                deploy: "node_modules/@cartesi/pos/dist/deploy",
            },
        ],
        deployments: {
            localhost: [
                "node_modules/@cartesi/util/deployments/localhost",
                "node_modules/@cartesi/token/deployments/localhost",
                "node_modules/@cartesi/pos/deployments/localhost",
                "node_modules/@cartesi/tree/deployments/localhost",
            ],
            mainnet: [
                "node_modules/@cartesi/util/deployments/mainnet",
                "node_modules/@cartesi/token/deployments/mainnet",
                "node_modules/@cartesi/pos/deployments/mainnet",
                "node_modules/@cartesi/tree/deployments/mainnet",
            ],
            goerli: [
                "node_modules/@cartesi/util/deployments/goerli",
                "node_modules/@cartesi/token/deployments/goerli",
                "node_modules/@cartesi/pos/deployments/goerli",
                "node_modules/@cartesi/tree/deployments/goerli",
            ],
            sepolia: [
                "node_modules/@cartesi/util/deployments/sepolia",
                "node_modules/@cartesi/token/deployments/sepolia",
                "node_modules/@cartesi/pos/deployments/sepolia",
                "node_modules/@cartesi/tree/deployments/sepolia",
            ],
        },
    },
    typechain: {
        outDir: "src/types",
        target: "ethers-v5",
    },
    etherscan: {
        apiKey: process.env.ETHERSCAN_API_KEY,
    },
    namedAccounts: {
        deployer: {
            default: 0,
        },
        beneficiary: {
            default: 1,
        },
    },
};

export default config;
