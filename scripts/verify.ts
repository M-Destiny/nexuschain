/**
 * Verify NexusChainMarketplace on HashScan
 *
 * Usage:
 *   npx hardhat run scripts/verify.ts --network testnet <contract-address>
 *
 * Environment variables:
 *   HASHSCAN_API_KEY - Required for verification
 */

import { ethers } from 'hardhat';

async function main() {
  const network = process.env.HARDHAT_NETWORK || 'hardhat';
  const contractAddress = process.argv[2];

  if (!contractAddress) {
    console.error('Usage: npx hardhat run scripts/verify.ts --network <network> <contract-address>');
    process.exit(1);
  }

  if (!process.env.HASHSCAN_API_KEY) {
    console.error('❌ HASHSCAN_API_KEY environment variable is required');
    process.exit(1);
  }

  console.log(`🔍 Verifying contract ${contractAddress} on ${network}...`);

  try {
    await hre.run('verify:verify', {
      address: contractAddress,
      constructorArguments: [],
    });
    console.log('✅ Contract verified on HashScan');
    console.log(`📋 View at: https://hashscan.io/${network}/contract/${contractAddress}`);
  } catch (err) {
    console.error('❌ Verification failed:', (err as Error).message);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error('❌ Script failed:', error);
  process.exit(1);
});