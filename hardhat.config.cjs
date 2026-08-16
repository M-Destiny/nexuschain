/** @type import('hardhat/config').HardhatUserConfig */
require('@nomicfoundation/hardhat-toolbox');
require('@typechain/hardhat');
require('dotenv/config');

const config = {
  solidity: {
    version: '0.8.24',
    settings: {
      optimizer: {
        enabled: true,
        runs: 200,
      },
      viaIR: true,
    },
  },
  networks: {
    hardhat: {
      chainId: 1337,
    },
    local: {
      url: 'http://localhost:50211',
      accounts: ['0x91132178e72057a8d1d2d65e0d0c7c8a4c8e5b6e9f0d3c9e1a0b4c5d6e7f8a9b0'],
      chainId: 296,
      gasPrice: 'auto',
    },
    testnet: {
      url: 'https://testnet.hashio.io/api',
      accounts: process.env.HEDERA_PRIVATE_KEY ? [process.env.HEDERA_PRIVATE_KEY] : [],
      chainId: 296,
      gasPrice: 'auto',
    },
    mainnet: {
      url: 'https://mainnet.hashio.io/api',
      accounts: process.env.HEDERA_PRIVATE_KEY ? [process.env.HEDERA_PRIVATE_KEY] : [],
      chainId: 295,
      gasPrice: 'auto',
    },
    previewnet: {
      url: 'https://previewnet.hashio.io/api',
      accounts: process.env.HEDERA_PRIVATE_KEY ? [process.env.HEDERA_PRIVATE_KEY] : [],
      chainId: 297,
      gasPrice: 'auto',
    },
  },
  etherscan: {
    apiKey: {
      testnet: process.env.HASHSCAN_API_KEY || '',
      mainnet: process.env.HASHSCAN_API_KEY || '',
    },
    customChains: [
      {
        network: 'testnet',
        chainId: 296,
        urls: {
          apiURL: 'https://hashscan.io/testnet/api',
          browserURL: 'https://hashscan.io/testnet',
        },
      },
      {
        network: 'mainnet',
        chainId: 295,
        urls: {
          apiURL: 'https://hashscan.io/mainnet/api',
          browserURL: 'https://hashscan.io/mainnet',
        },
      },
    ],
  },
  gasReporter: {
    enabled: process.env.REPORT_GAS === 'true',
    currency: 'USD',
    outputFile: 'gas-report.txt',
  },
  sourcify: {
    enabled: true,
  },
  typechain: {
    outDir: 'typechain-types',
    target: 'ethers-v6',
    alwaysGenerateOverloads: false,
    externalArtifacts: ['artifacts/**/*.json'],
    dontOverrideCompile: true,
  },
};

module.exports = config;