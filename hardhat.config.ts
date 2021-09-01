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
        ropsten: infuraNetwork("ropsten", 3, 6283185),
        rinkeby: infuraNetwork("rinkeby", 4, 6283185),
        kovan: infuraNetwork("kovan", 42, 6283185),
        goerli: infuraNetwork("goerli", 5, 6283185),
        mainnet: infuraNetwork("mainnet", 1, 6283185),
        matic_testnet: infuraNetwork("polygon-mumbai", 80001),
        bsc_testnet: {
            url: "https://data-seed-prebsc-1-s1.binance.org:8545",
            chainId: 97,
            accounts: mnemonic ? { mnemonic } : undefined,
        },
    },
    solidity: {
        compilers: [
            {
                version: "0.8.6",
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
                artifacts: "node_modules/@cartesi/pos/export/artifacts",
                deploy: "node_modules/@cartesi/pos/dist/deploy",
            },
        ],
        deployments: {
            localhost: [
                "node_modules/@cartesi/util/deployments/localhost",
                "node_modules/@cartesi/token/deployments/localhost",
                "node_modules/@cartesi/pos/deployments/localhost",
            ],
            mainnet: [
                "node_modules/@cartesi/util/deployments/mainnet",
                "node_modules/@cartesi/token/deployments/mainnet",
                "node_modules/@cartesi/pos/deployments/mainnet",
            ],
            ropsten: [
                "node_modules/@cartesi/util/deployments/ropsten",
                "node_modules/@cartesi/token/deployments/ropsten",
                "node_modules/@cartesi/pos/deployments/ropsten",
            ],
            rinkeby: [
                "node_modules/@cartesi/util/deployments/rinkeby",
                "node_modules/@cartesi/token/deployments/rinkeby",
                "node_modules/@cartesi/pos/deployments/rinkeby",
            ],
            kovan: [
                "node_modules/@cartesi/util/deployments/kovan",
                "node_modules/@cartesi/token/deployments/kovan",
                "node_modules/@cartesi/pos/deployments/kovan",
            ],
            goerli: [
                "node_modules/@cartesi/util/deployments/goerli",
                "node_modules/@cartesi/token/deployments/goerli",
                "node_modules/@cartesi/pos/deployments/goerli",
            ],
            matic_testnet: [
                "node_modules/@cartesi/util/deployments/matic_testnet",
                "node_modules/@cartesi/token/deployments/matic_testnet",
                "node_modules/@cartesi/pos/deployments/matic_testnet",
            ],
            bsc_testnet: [
                "node_modules/@cartesi/util/deployments/bsc_testnet",
                "node_modules/@cartesi/token/deployments/bsc_testnet",
                "node_modules/@cartesi/pos/deployments/bsc_testnet",
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
