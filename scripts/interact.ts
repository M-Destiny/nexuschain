/**
 * NexusChain Marketplace Interaction Script
 *
 * Demonstrates basic contract interactions after deployment.
 *
 * Usage:
 *   npx hardhat run scripts/interact.ts --network testnet
 */

import { ethers } from 'hardhat';

async function main() {
  const network = process.env.HARDHAT_NETWORK || 'hardhat';
  const marketplaceAddress = process.env.MARKETPLACE_CONTRACT;

  if (!marketplaceAddress) {
    console.error('❌ MARKETPLACE_CONTRACT environment variable is required');
    console.error('   Set it to the deployed contract address from deployments/<network>.json');
    process.exit(1);
  }

  console.log(`📦 Interacting with NexusChainMarketplace at ${marketplaceAddress} on ${network}`);

  const [signer] = await ethers.getSigners();
  console.log(`👤 Signer: ${signer.address}`);

  const marketplace = await ethers.getContractAt('NexusChainMarketplace', marketplaceAddress, signer);

  // Check treasury
  const treasury = await marketplace.treasury();
  console.log(`🏦 Treasury: ${treasury}`);

  // Get governance token
  const governanceToken = await marketplace.governanceToken();
  console.log(`🗳️  Governance Token: ${governanceToken}`);

  // Register a test agent
  console.log('\n📝 Registering test agent...');
  const tx = await marketplace.registerAgent(
    'agent-test-001',
    'Test Agent',
    'A test AI agent for demonstration',
    1000000, // 0.01 HBAR per call in tinybars
    'bafytestcid123',
    ['text-generation', 'code-review']
  );
  await tx.wait();
  console.log('✅ Agent registered');

  // Get agent details
  const agent = await marketplace.getAgent('agent-test-001');
  console.log(`📋 Agent: ${agent.name} (${agent.id})`);
  console.log(`   Owner: ${agent.owner}`);
  console.log(`   Price: ${Number(agent.pricePerCall) / 1e8} HBAR/call`);
  console.log(`   Active: ${agent.isActive}`);
  console.log(`   Capabilities: ${agent.capabilities.join(', ')}`);
  console.log(`   IPFS CID: ${agent.ipfsCid}`);

  // List the agent on marketplace
  console.log('\n🏪 Listing agent on marketplace...');
  const listTx = await marketplace.listAgent('agent-test-001', 2000000); // 0.02 HBAR
  await listTx.wait();
  console.log('✅ Agent listed');

  const listing = await marketplace.listings('agent-test-001');
  console.log(`📋 Listing price: ${Number(listing.price) / 1e8} HBAR`);
  console.log(`   Views: ${listing.views}`);

  // Purchase the agent
  console.log('\n💳 Purchasing agent...');
  const purchaseTx = await marketplace.purchaseAgent('agent-test-001', { value: ethers.parseEther('0.02') });
  await purchaseTx.wait();
  console.log('✅ Agent purchased');

  // Rate the agent
  console.log('\n⭐ Rating agent...');
  const rateTx = await marketplace.rateAgent('agent-test-001', 5);
  await rateTx.wait();
  console.log('✅ Agent rated 5 stars');

  const avgRating = await marketplace.getAverageRating('agent-test-001');
  console.log(`📊 Average rating: ${avgRating}/5`);

  // Create a governance proposal
  console.log('\n🗳️  Creating governance proposal...');
  const proposalTx = await marketplace.createProposal(
    'prop-001',
    'Increase Platform Fee',
    'Proposal to increase platform fee from 5% to 7%',
    1 // 1 day
  );
  await proposalTx.wait();
  console.log('✅ Proposal created');

  // Vote on proposal
  console.log('\n🗳️  Voting on proposal...');
  const voteTx = await marketplace.vote('prop-001', true, ethers.parseEther('100'));
  await voteTx.wait();
  console.log('✅ Vote cast (FOR)');

  // Check proposal status
  const proposal = await marketplace.proposals('prop-001');
  console.log(`📋 Proposal: ${proposal.title}`);
  console.log(`   For: ${ethers.formatEther(proposal.forVotes)} HBAR`);
  console.log(`   Against: ${ethers.formatEther(proposal.againstVotes)} HBAR`);
  console.log(`   Deadline: ${new Date(Number(proposal.deadline) * 1000).toLocaleString()}`);

  console.log('\n🎉 Interaction demo complete!');
}

main().catch((error) => {
  console.error('❌ Interaction failed:', error);
  process.exit(1);
});