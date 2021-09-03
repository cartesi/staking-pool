> :warning: The Cartesi team keeps working internally on the next version of this repository, following its regular development roadmap. Whenever there's a new version ready or important fix, these are published to the public source tree as new releases.

# PoS Staking Pools

This repository hosts smart contracts that enable individuals or institutions to create Staking Pools on top of [Cartesi Proof of Stake system](https://github.com/cartesi/pos-dlib).

The `StakingPool` acts as a regular user of the Cartesi Proof of Stake system, so it's interesting to know how it works before managing a pool. This pool system is also integrated on the [Noether Node](https://github.com/cartesi/noether). Read more on the [node section](##node) of this documentation.

In order to improve maintainability and auditing, the pool contract is composed of five facets:

-   [Staking](#staking)
-   [User](#user-controls)
-   [Worker](#worker)
-   [Management](#management)
-   [Block producer](#block-producer)

Here is the overview diagram:

<p align="center"><img src="overview.png" alt="overview diagram" title= "overview diagram" width="70%" /></p>

## Staking

The pool is also a client to the [Staking Contract](https://github.com/cartesi/pos-dlib/blob/master/contracts/StakingImpl.sol) part of the Cartesi PoS. So we define the behavior of staking, unstaking, and withdrawing CTSI amounts.

The main function responsible for managing these actions is `rebalance()` function. When called, the function decides (based on `amounts()` function response) whether it should stake, unstake or withdraw any CTSI value. The logic for the decision is encapsulated under `amounts()` and is as follows:

-   Anytime a user wants to exit, we save this request under `requiredLiquidity`, which is the overall liquidity necessary to fulfill all users' requests to leave the pool.

-   It checks for any free balance under the contract's account on the ERC20 ledger (let's call it `balance`). If it's more than the `requiredLiquidity`, then it means it has an outstanding value that can be staked on behalf of all the pool. E.g., when a new user joins and asks to stake, then we have this free balance. As a result, the `uint256 stake` is returned with the exact value to be staked.

-   If there was a staking request in less than 6 hours (time to maturate the stake on Cartesi PoS), it won't return the value mentioned before. This prevents a clock reset that would force the previous request to wait for more than 6 hours.

-   In the case of `requiredLiquidity` being more than the current `balance`, this prompts an unstake request. The missing liquidity is returned into `uint256 unstake`.

-   Similarly, with the stake scenario, we need to avoid resetting the 48 hours unstaking clock for the Cartesi PoS. So, if it checks for a releasing balance, and if ready to be withdrawn, we return it into the `uint256 withdraw` variable. Otherwise, it waits for the timeout and returns 0 values for `unstake` and `withdraw` variables.

Here is a diagram displaying this logic:

<p align="center"><img src="staking.png" alt="staking diagram" title= "staking diagram" width="80%" /></p>

## User (controls)

This section is responsible for exposing controls for the users to join and exit the pool. It implements the following actions: deposit, stake, unstake, and withdraw.

The first step to join the pool is to `deposit()` some CTSI tokens. The user should set an allowance on the ERC20 CTSI contract and then call `deposit()` with the desired stake amount. This action will transfer the tokens to the
pool contract and start a timeout timer for the next step.

> We define a timeout between `deposit()` and `stake()` steps so the pool is protected against possible exploits. An attacker tries to predict what pool will be the next selected to produce a block and attempts to join it just before it happens so they can participate in the reward without having to wait.

Now, the user can call `stake()`, which will decrease their internal balance with the pool in exchange for shares. The shares are issued at the current rate of parity between all shares vs all pool-staked balances.
The user participates in rewards right away.

As a secondary effect, after a call to `stake()` happens, the contract will be ready to stake this new available balance on the Cartesi PoS system.

The next natural step is to eventually `unstake()` some quantity of shares. By calling `unstake()`, the user will convert their shares into a CTSI balance at the current exchange rate. As a secondary effect, it will signal to the contract
to also unstake CTSI on the Cartesi PoS, so later it's available for the user to withdraw.

> NOTE: if there is an influx of users at the same time someone tries to leave, that will make the pool contract liquid without calling unstake on Cartesi PoS contracts. As a result, this hypothetical user will be able to exit the pool faster.

Finally, whenever the user has a free balance (after a `deposit` or after calling `unstake`), and the pool also has the required liquidity (active balance on the ERC20 CTSI contract), they are allowed to call `withdraw()` for how much they want to have transferred to their wallets.

<p align="center"><img src="user.png" alt="user flow diagram" title= "user flow diagram" width="80%"/></p>

## Worker

The Cartesi PoS system has two main external account actors: owner/user and their Noether node worker, and because the pool needs to be aware of rewards, it means the pool also needs to be its worker.

In addition, Noether nodes check for hiring directly on the blockchain; that's how it knows its owner.

Therefore, this section contains the necessary pieces for hiring (self hiring) and managing workers.

- `selfhire()`: Not meant to be called manually, this function is part of the deployment process inside the factory. It establishes the owner-worker relationship of the pool on the Cartesi PoS system.

- `hire()`, `cancelHire()`, `retire()`: These functions are connected to configuring a Noether node. Here you select (hire) your node based on its address. Stop the hiring process (cancelHire). Or, retrieves your funds 
from the node before permanently shutting it down (retire). 

## Management

For pool management we have a set of functionalities split into two contracts: `StakingPoolManagementImpl` and fees (one of: `FlatRateCommission`, `GasTaxCommission`).

### StakingPoolManagementImpl

-   `setName()`: This function allows the pool manager (owner) to set the name for the pool on the ENS registries.
-   `pause()`/`unpause()`: To the pool manager is reserved the right to stop new deposits and stakes at any time. By calling `pause()`, no user will be allowed to add more CTSI into the pool system. However, they will be able to `unstake()` and `withdraw()` their funds even if the contract is paused.

The commission system for the pools is modular. An external contract linked to the pool is responsible for informing the pool contract of the size of the commission at every newly produced block. At this time, there are two implementations: FlatRateCommission and GasTaxCommission.

### FlatRateCommission

Flat Rate is the simplest form of commission possible: a set % of cut of the reward. The owner sets the % they want as a cut for managing the pool systems at the time of deployment. The fee can be lowered at any time. However, it is bounded by two limits when raising the fee:

-   After raising the fee once, they must wait for a predefined timeout to raise the fee again.
-   They can only raise at most `maxRaise` at a time. (eg.: maxRaise=5%, so a fee of 3% can only go to 8% in one step)

### GasTaxCommission

The gas tax is a commission rule based on gas costs. The pool manager sets how much gas they want to be reimbursed, and then this contract makes two conversions using Chainlink oracles: gas-> ether-> ctsi. Using oracles, it checks for the average gasPrice to obtain the ETH value, then it also checks the oracle for the average ETH-CTSI price to repeat the process.

It also follows the same rules as the FlatRate. The owner can lower the at any time, but it is bounded by two limits when raising the fee:

-   After raising the fee once, they must wait for a predefined timeout to raise the fee again.
-   They can only raise at most `maxRaise` at a time. (e.g., maxRaise=5000, so a fee of 1000 gas can only go to 6000 in one step)

## Block Producer

In this section, we handle the actual block production in a transaction started by the Noether node. The `produceBlock` function handles the PoS system call and processes the reward by cutting the fees and adding the rest into the overall stake.

The commission (fees) are sent directly to the pool manager's wallet. The balance of the pool gets the remaining reward and, because we don't issue new shares at this moment, the distribution happens as intended.

<p align="center"><img src="producer.png" alt="producer diagram" title= "producer diagram" width="60%" /></p>

## Build

To get a list of all available `yarn` targets run:

```shell
% yarn run info
```

## Contributing

Thank you for your interest in Cartesi! Head over to our [Contributing Guidelines](CONTRIBUTING.md) for instructions on how to sign our Contributors Agreement and get started with Cartesi!

Please note we have a [Code of Conduct](CODE_OF_CONDUCT.md), please follow it in all your interactions with the project.

# Authors

-   _Gabriel Barros_
-   _Danilo Tuler_

## License

This repository and all contributions are licensed under
[APACHE 2.0](https://www.apache.org/licenses/LICENSE-2.0). Please review our [LICENSE](LICENSE) file.
