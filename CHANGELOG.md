# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.0.0-beta.3] - 2021-09-10

### Changed

-   Fix GasTaxCommission calculation bug as the price oracle is CTSI/ETH, not ETH/CTSI

## [1.0.0-beta.2] - 2021-09-05

### Changed

-   Outdated artifacts

## [1.0.0-beta.1] - 2021-08-30

### Changed

-   Update OpenZeppelin to 4.3.1
-   Replaced Uniswap V3 price Oracle with Chainlink price Oracle
-   Upgrade solc to 0.8.7

## [1.0.0-beta.0] - 2021-08-23

### Changed

-   Refactored pool implementation, spliting implementation in 5 different facets
-   Allow increasing of commission under new rules (one increase per week, cap to a maximum change)
-   Reduced gas of block production
-   Added deposit operation for users prior to staking
-   Decoupling pool factory from reference pool deployment
-   Allow pool factory to change reference pool implementation

## [1.0.0-alpha.2] - 2021-06-30

### Changed

-   Fixing reference to Staking contract

## [1.0.0-alpha.1] - 2021-06-29

### Changed

-   Changed ropsten maturation times

## [1.0.0-alpha.0] - 2021-06-29

Initial version

[unreleased]: https://github.com/cartesi/pos-dlib/compare/v1.0.0-alpha.1...HEAD
[1.0.0-alpha.1]: https://github.com/cartesi/pos-dlib/compare/v1.0.0-alpha.0...v1.0.0-alpha.1
[1.0.0-alpha.0]: https://github.com/cartesi/pos-dlib/releases/tag/v1.0.0-alpha.0
