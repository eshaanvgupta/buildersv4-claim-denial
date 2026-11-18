require("@nomicfoundation/hardhat-toolbox");

// Pinned Base mainnet fork. The default endpoint is a public archive RPC
// that serves state at this block; set BASE_RPC_URL to use your own.
const BASE_RPC = process.env.BASE_RPC_URL || "https://base-mainnet.public.blastapi.io";
const FORK_BLOCK = Number(process.env.BASE_FORK_BLOCK || 58750000);

module.exports = {
  solidity: { version: "0.8.24", settings: { optimizer: { enabled: true, runs: 200 } } },
  networks: {
    hardhat: {
      forking: { url: BASE_RPC, blockNumber: FORK_BLOCK },
      chainId: 8453,
      hardfork: "cancun",
      allowUnlimitedContractSize: true,
      gas: 16000000,
      blockGasLimit: 16000000,
      chains: { 8453: { hardforkHistory: { shanghai: 0, cancun: 1 } } },
    },
  },
  mocha: { timeout: 1800000 },
};
