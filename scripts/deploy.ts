/**
 * NexusChain Marketplace Deployment Script
 *
 * Deploys the NexusChainMarketplace contract to Hedera testnet/mainnet.
 *
 * Usage:
 *   npx hardhat run scripts/deploy.ts --network testnet
 *   npx hardhat run scripts/deploy.ts --network mainnet
 *
 * Environment variables required:
 *   HEDERA_PRIVATE_KEY - Private key of deployer account
 *   HEDERA_ACCOUNT_ID - Account ID of deployer (0.0.xxxxx)
 *   HEDERA_NETWORK - testnet | mainnet | previewnet
 *
 * Optional:
 *   HASHSCAN_API_KEY - For contract verification on HashScan
 *   GOVERNANCE_TOKEN_ADDRESS - Existing HTS governance token (otherwise creates new)
 *   TREASURY_ADDRESS - Treasury address for platform fees (defaults to deployer)
 */

import { ethers } from 'hardhat';
import * as fs from 'fs';
import * as path from 'path';

async function main() {
  const network = process.env.HARDHAT_NETWORK || 'hardhat';
  console.log(`🚀 Deploying to ${network}...`);

  // Get deployer account
  const [deployer] = await ethers.getSigners();
  console.log(`📝 Deployer: ${deployer.address}`);

  // Get deployer balance
  const balance = await ethers.provider.getBalance(deployer.address);
  console.log(`💰 Balance: ${ethers.formatEther(balance)} HBAR`);

  if (balance === 0n) {
    throw new Error('Deployer has 0 HBAR. Fund the account first.');
  }

  // Treasury defaults to deployer if not specified
  const treasuryAddress = process.env.TREASURY_ADDRESS || deployer.address;
  console.log(`🏦 Treasury: ${treasuryAddress}`);

  // Deploy the marketplace contract
  console.log('\n📦 Deploying NexusChainMarketplace...');
  const NexusChainMarketplace = await ethers.getContractFactory('NexusChainMarketplace');
  const marketplace = await NexusChainMarketplace.deploy();
  await marketplace.waitForDeployment();

  const marketplaceAddress = await marketplace.getAddress();
  console.log(`✅ NexusChainMarketplace deployed to: ${marketplaceAddress}`);

  // Set treasury
  console.log('\n🔧 Configuring treasury...');
  const setTreasuryTx = await marketplace.setTreasury(treasuryAddress);
  await setTreasuryTx.wait();
  console.log(`✅ Treasury set to: ${treasuryAddress}`);

  // Save deployment info
  const deploymentInfo = {
    network,
    marketplace: marketplaceAddress,
    treasury: treasuryAddress,
    deployer: deployer.address,
    deployedAt: new Date().toISOString(),
    blockNumber: await ethers.provider.getBlockNumber(),
  };

  const deploymentsDir = path.join(__dirname, '..', 'deployments');
  if (!fs.existsSync(deploymentsDir)) {
    fs.mkdirSync(deploymentsDir, { recursive: true });
  }

  const deploymentFile = path.join(deploymentsDir, `${network}.json`);
  fs.writeFileSync(deploymentFile, JSON.stringify(deploymentInfo, null, 2));
  console.log(`\n💾 Deployment info saved to: ${deploymentFile}`);

  // Print summary
  console.log('\n📋 DEPLOYMENT SUMMARY');
  console.log('=====================');
  console.log(`Network:      ${network}`);
  console.log(`Marketplace:  ${marketplaceAddress}`);
  console.log(`Treasury:     ${treasuryAddress}`);
  console.log(`Deployer:     ${deployer.address}`);
  console.log(`Explorer:     https://hashscan.io/${network}/contract/${marketplaceAddress}`);

  // Verify on HashScan if API key provided
  if (process.env.HASHSCAN_API_KEY) {
    console.log('\n🔍 Verifying contract on HashScan...');
    try {
      await hre.run('verify:verify', {
        address: marketplaceAddress,
        constructorArguments: [],
      });
      console.log('✅ Contract verified on HashScan');
    } catch (err) {
      console.warn('⚠️  Verification failed:', (err as Error).message);
    }
  } else {
    console.log('\n💡 To verify on HashScan, set HASHSCAN_API_KEY and run:');
    console.log(`   npx hardhat verify --network ${network} ${marketplaceAddress}`);
  }

  // Print next steps
  console.log('\n📝 NEXT STEPS:');
  console.log('1. Update nexuschain.config.yaml with the contract address');
  console.log(`   marketplace: "${marketplaceAddress}"`);
  console.log('2. Fund the contract with HBAR for gas');
  console.log('3. Register agents using: nexuschain register <name> --desc "..." --price <hbar>');
  console.log('4. List agents on marketplace: nexuschain list');

  return marketplaceAddress;
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('❌ Deployment failed:', error);
    process.exit(1);
  });