export default () => ({
  port: parseInt(process.env.PORT || "8080", 10),
  blockchain: {
    rpcUrl: process.env.RPC_URL || "https://base-rpc.publicnode.com",
    chainId: parseInt(process.env.CHAIN_ID || "8453", 10), // Base mainnet
    privateKey: process.env.PRIVATE_KEY || "",
    // autoExecute: process.env.AUTO_EXECUTE === "true",
    autoExecute: true,
  },
  contracts: {
    aavePool: "0xA238Dd80C259a72e81d7e4664a9801593F98d1c5",
    poolDataProvider: "0x2d8A3C5677189723C4cB8873CfC9C8976FDF38Ac",
    uniswapRouter: "0x2626664c2603336E57B271c5C0b26F421741e481",
    uniswapQuoter: "0x3d4e44Eb1374240CE5F1B871ab261CD16335B76a",
  },
  tokens: {
    // Stablecoins
    USDC: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    USDbC: "0xd9aAEc86B65D86f6A7B5B1b0c42FFA531710b6CA", // USD Base Coin (bridged USDC)
    USDT: "0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2",
    DAI: "0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb",
    GHO: "0x6Bb7a212910682DCFdbd5BCBb3e28FB4E8da10Ee", // Aave's decentralized stablecoin
    EURC: "0x60a3E35Cc302bFA44Cb288Bc5a4F316Fdb1adb42", // Circle's Euro Coin

    // ETH and LSTs (Liquid Staking Tokens)
    WETH: "0x4200000000000000000000000000000000000006",
    cbETH: "0x2Ae3F1Ec7F1F5012CFEab0185bfc7aa3cf0DEc22", // Coinbase Wrapped Staked ETH
    wstETH: "0xc1CBa3fCea344f92D9239c08C0568f6F2F0ee452", // Lido Wrapped Staked ETH
    weETH: "0x04C0599Ae5A44757c0af6F9eC3b93da8976c150A", // Wrapped eETH
    ezETH: "0x2416092f143378750bb29b79eD961ab195CcEea5", // Renzo ezETH
    wrsETH: "0xEDfa23602D0EC14714057867A78d01e94176BEA0", // Wrapped rsETH (Kelp)

    // Bitcoin variants
    cbBTC: "0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf", // Coinbase Wrapped BTC
    LBTC: "0xecAc9C5F704e954931349Da37F60E39f515c11c1", // Lombard BTC

    // Governance tokens
    AAVE: "0x63706e401c06ac8513145b7687A14804d17f814b", // Aave governance token
  },
  uniswap: {
    feeTiers: [100, 500, 3000, 10000], // 0.01%, 0.05%, 0.3%, 1%
    maxSlippage: 1, // 1%
  },
  logging: {
    level: process.env.LOG_LEVEL || "info",
  },
});
