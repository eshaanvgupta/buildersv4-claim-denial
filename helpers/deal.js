const { ethers, network } = require("hardhat");

// Known ERC20 balance storage slots (avoids a slow brute-force scan).
const KNOWN = {
  "0x7431ada8a591c955a994a21710752ef9b882b8e3": 1,  // MOR (MOROFT), Base mainnet
};

async function trySlot(tokenAddr, holder, amount, slot, vyper) {
  const idx = vyper
    ? ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(["uint256", "address"], [slot, holder]))
    : ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(["address", "uint256"], [holder, slot]));
  const prev = await network.provider.send("eth_getStorageAt", [tokenAddr, idx, "latest"]);
  await network.provider.send("hardhat_setStorageAt", [tokenAddr, idx, ethers.toBeHex(amount, 32)]);
  const erc20 = new ethers.Contract(tokenAddr, ["function balanceOf(address) view returns (uint256)"], ethers.provider);
  if ((await erc20.balanceOf(holder)) === amount) return true;
  await network.provider.send("hardhat_setStorageAt", [tokenAddr, idx, prev]);
  return false;
}

/// Writes an ERC20 balance directly into storage via hardhat_setStorageAt.
/// This only funds the attacker's own wallet; no protocol account or owner key is used.
async function deal(tokenAddr, holder, amount, maxSlot = 60) {
  const hint = KNOWN[tokenAddr.toLowerCase()];
  if (hint !== undefined && (await trySlot(tokenAddr, holder, amount, hint, false))) return { slot: hint };
  for (let slot = 0; slot < maxSlot; slot++) {
    for (const vyper of [false, true]) {
      if (await trySlot(tokenAddr, holder, amount, slot, vyper)) return { slot, vyper };
    }
  }
  throw new Error(`could not locate balance slot for ${tokenAddr}`);
}
module.exports = { deal };
