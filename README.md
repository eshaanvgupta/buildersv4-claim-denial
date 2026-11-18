# An unprivileged deposit permanently denies an honest BuildersV4 subnet its accrued rewards

Proof of concept for a Morpheus Bug Bounty submission. It runs against the **deployed bytecode** on a **Base mainnet fork pinned to block 58,750,000** and the attacker is a **fresh EOA with no role of any kind**.

## Run

```bash
npm install
npx hardhat test
```

The default endpoint is a public Base archive RPC that serves state at the pinned block; set `BASE_RPC_URL` to use your own.

## The result

An ordinary address, holding only MOR and administering nothing, deposits into a subnet it does not own, waits, and withdraws its entire deposit. That subnet's honest admin can no longer collect anything.

| | Control | After the attack |
|---|---|---|
| Honest admin collects after 60 days | **33,880.21 MOR ($23,675)** | **0 MOR** |
| `claim()` result | succeeds | reverts `ERC20: transfer amount exceeds balance` |
| Attacker net cost | n/a | **0 MOR**, full capital recovered |
| Still denied at +30 / +180 / +365 days | n/a | yes, owed grows to 362,601 MOR |

Every legitimate administrator stays honest. The victim subnet's admin is impersonated only to measure what it loses, never to perform an attacker action.

## Mechanism

Three properties combine. None of them is an administrator action.

**1. `claim()` is all-or-nothing against a shared, finite balance.**

```solidity
uint256 pendingRewards_ = subnetData.pendingRewards;
require(pendingRewards_ > 0, "BU: nothing to claim");
subnetData.pendingRewards = 0;
...
IBuildersTreasuryV2(buildersTreasury).sendRewards(receiver_, pendingRewards_);
```

There is no partial claim and no cap at the treasury balance. If `pendingRewards` exceeds what `BuildersTreasuryV2` holds, the transfer reverts and the subnet collects nothing, not even the portion the treasury could cover.

**2. `pendingRewards` is credited from the emission curve with no backing check.**

`_getCurrentRate()` derives the rate from `RewardPool.getPeriodRewards(3, ...)` scaled by `networkShare`. It never reads the treasury balance. BuildersV3 did exactly the opposite:

```solidity
// BuildersV3
function getNotDistributedRewards() public view returns (uint256) {
    return IBuildersTreasury(buildersTreasury).getAllRewards() - totalPoolData.distributedRewards;
}
```

V3 could not credit more than the treasury actually held. V4 removed that constraint, and at the pinned block the protocol already credits **65,804 MOR** against a treasury of **53,450 MOR**.

**3. `deposit()` accepts deposits into any subnet from anyone.**

```solidity
function deposit(bytes32 subnetId_, uint256 amount_) external onlyExistedSubnet(subnetId_) {
```

A third party can raise any subnet's share of the emission without that subnet's consent, driving its `pendingRewards` over the treasury balance. Because `pendingRewards` only ever grows, the position never becomes claimable again.

## Capital threshold

Measured on the fork at a 60 day horizon against the live victim subnet:

| Attacker deposit | Subnet owed | Honest admin's claim |
|---|---|---|
| 0 MOR | 33,880 MOR | paid |
| 250,000 MOR | 41,752 MOR | paid |
| 500,000 MOR | 48,499 MOR | paid |
| **1,000,000 MOR** | **59,463 MOR** | **denied** |
| 2,000,000 MOR | 74,815 MOR | denied |
| 3,000,000 MOR | 85,050 MOR | denied |

The PoC uses 1,000,000 MOR, the smallest sampled amount that flips the outcome. Base MOR total supply at the pinned block is about 6.37M, so this is an ordinary, obtainable position. The capital is returned in full.

## Preconditions, stated plainly

* The attacker needs roughly 1,000,000 MOR of working capital for the duration. It is never spent, only parked, so the cost is opportunity cost and gas.
* The honest admin must not claim during the window. An admin that claims often enough resets `pendingRewards` and stays under the threshold, so this is a real precondition rather than an unconditional break. It is also unmonitorable from the admin's side: nothing in the contract warns that the threshold is approaching, and once it is crossed the admin has no on-chain way back.
* The denial holds while `pendingRewards` exceeds the treasury balance. Since the owed figure grows monotonically and faster than it did before the attack, topping the treasury up to the pre-attack figure no longer suffices.

## Target

`BuildersV4` `0x42BB446eAE6dca7723a9eBdb81EA88aFe77eF4B9` on Base mainnet, with `BuildersTreasuryV2` `0x9eba628581896ce086cb8f1A513ea6097A8FC561`. Both are listed in Appendix A of the Morpheus Bug Bounty Program, version 2, dated 2026-08-07.

## No privileged accounts

The attacker is a default Hardhat signer with no role in any Morpheus contract. It never calls an owner, admin or `onlySubnetOwner` function, and it never creates or administers the subnet it attacks.

`hardhat_impersonateAccount` is used once, on the victim subnet's honest admin, purely to execute that admin's own `claim()` and measure what it receives. Removing those lines removes the measurement, not the attack.

State written outside the attacker's wallet is limited to the attacker's own MOR balance, funded with `hardhat_setStorageAt` on the MOR token so the run does not depend on a whale address. **No Morpheus contract code and no Morpheus storage slot is modified.**

## Layout

```
helpers/deal.js          funds the attacker's own MOR balance via storage
test/ClaimDenial.js      the proof of concept
hardhat.config.js        Base mainnet fork, pinned to block 58,750,000
```
