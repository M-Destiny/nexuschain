#!/usr/bin/env node
/**
 * NexusChain CLI — On-chain AI Agent Marketplace
 * Commands: init, register, list, buy, rate, governance
 */
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import * as yaml from 'js-yaml';
import { Command } from 'commander';
import { HederaClient } from './hedera/client.js';
import { AgentRegistry } from './agent-registry.js';
import { Marketplace } from './marketplace.js';
import { Governance } from './governance.js';
import chalk from 'chalk';
import type { NexusChainConfig } from './types.js';

function loadConfig(): NexusChainConfig {
  const path = join(process.cwd(), 'nexuschain.config.yaml');
  if (!existsSync(path)) throw new Error('Config not found. Run: nexuschain init');
  return yaml.load(readFileSync(path, 'utf8')) as NexusChainConfig;
}

function saveConfig(config: NexusChainConfig) {
  const path = join(process.cwd(), 'nexuschain.config.yaml');
  writeFileSync(path, yaml.dump(config), 'utf8');
}

const program = new Command();
program.name('nexuschain').description('On-chain AI agent marketplace powered by Hedera').version('0.1.0');

program.command('init').description('Initialize NexusChain configuration').action(() => {
  const config: NexusChainConfig = {
    hedera: {
      accountId: process.env.HEDERA_ACCOUNT_ID ?? '0.0.12345',
      privateKey: process.env.HEDERA_PRIVATE_KEY ?? '',
      network: (process.env.HEDERA_NETWORK as any) ?? 'testnet',
    },
    contracts: {
      marketplace: process.env.MARKETPLACE_CONTRACT ?? '0.0.67890',
      governanceToken: process.env.GOVERNANCE_TOKEN ?? '0.0.11111',
    },
    topics: {
      manifestTopicId: process.env.MANIFEST_TOPIC ?? '0.0.22222',
      governanceTopicId: process.env.GOVERNANCE_TOPIC ?? '0.0.33333',
      usageTopicId: process.env.USAGE_TOPIC ?? '0.0.44444',
    },
  };
  saveConfig(config);
  console.log(chalk.green('✓ Config created: nexuschain.config.yaml'));
  console.log(chalk.yellow('⚠ Edit nexuschain.config.yaml and set your Hedera account credentials'));
});

program.command('register <name>').description('Register an AI agent on-chain')
  .requiredOption('--desc <text>', 'Agent description')
  .requiredOption('--price <hbar>', 'Price per call in HBAR')
  .option('--cid <ipfs-cid>', 'IPFS CID of agent metadata', '')
  .option('--capabilities <csv>', 'Comma-separated capabilities', '')
  .action(async (name, opts) => {
    const config = loadConfig();
    const hedera = new HederaClient(config.hedera);
    const registry = new AgentRegistry(hedera, config.topics.manifestTopicId);

    const id = await registry.registerAgent({
      name,
      description: opts.desc,
      ownerId: hedera.getOperatorAccountId(),
      version: '1.0',
      pricing: { currency: 'HBAR', pricePerCall: opts.price, subscriptionTiers: [] as any },
      capabilities: opts.capabilities ? opts.capabilities.split(',').map((s: string) => s.trim()) : [],
      ipfsCid: opts.cid,
      hcsTopicId: config.topics.manifestTopicId,
      status: 'active',
      ratings: { average: 0, count: 0 },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }, config.hedera.privateKey);

    console.log(chalk.green(`✓ Agent registered: ${id}`));
    console.log(chalk.blue(`  View on: https://app.hedera.com/explorer/topic/${config.topics.manifestTopicId}`));
  });

program.command('list').description('List all marketplace agents').action(async () => {
  const config = loadConfig();
  const hedera = new HederaClient(config.hedera);
  const registry = new AgentRegistry(hedera, config.topics.manifestTopicId);
  const agents = await registry.listAgents();
  if (!agents.length) { console.log(chalk.yellow('No agents found')); return; }
  for (const a of agents) {
    console.log(`\n[${a.id.slice(0, 8)}] ${chalk.bold(a.name)}`);
    console.log(`  ${a.description}`);
    console.log(`  ⭐ ${a.ratings.average}/5 (${a.ratings.count} reviews) | 💰 ${a.pricing.pricePerCall} HBAR/call`);
    console.log(`  🔧 ${a.capabilities.join(', ')}`);
    console.log(`  Status: ${a.status}`);
  }
});

program.command('buy <agentId>').description('Purchase access to an agent')
  .option('--amount <hbar>', 'HBAR to pay', '1')
  .action(async (agentId, _opts) => {
    const config = loadConfig();
    const hedera = new HederaClient(config.hedera);
    const marketplace = new Marketplace(hedera, config.contracts.marketplace);
    const txId = await marketplace.purchaseAgent(agentId, hedera.getOperatorAccountId());
    console.log(chalk.green(`✓ Purchase complete! Tx: ${txId}`));
  });

program.command('rate <agentId>').description('Rate an agent')
  .requiredOption('--stars <1-5>', 'Rating (1-5)', (v) => parseInt(v))
  .action(async (agentId, opts) => {
    const config = loadConfig();
    const hedera = new HederaClient(config.hedera);
    const registry = new AgentRegistry(hedera, config.topics.manifestTopicId);
    await registry.rateAgent(agentId, opts.stars);
    console.log(chalk.green(`✓ Rated ${opts.stars} stars`));
  });

const govCmd = program.command('governance').description('Governance commands');

govCmd.command('proposals').description('List active proposals').action(async () => {
  const config = loadConfig();
  const hedera = new HederaClient(config.hedera);
  const governance = new Governance(hedera, config.contracts.governanceToken, config.topics.governanceTopicId);
  const proposals = governance.getActiveProposals();
  if (!proposals.length) { console.log(chalk.yellow('No active proposals')); return; }
  for (const p of proposals) {
    console.log(`\n[${p.id.slice(0, 8)}] ${chalk.bold(p.title)}`);
    console.log(`  ${p.description}`);
    console.log(`  For: ${p.forVotes} | Against: ${p.againstVotes} | Status: ${p.status}`);
    console.log(`  Deadline: ${new Date(p.deadline).toLocaleString()}`);
  }
});

govCmd.command('create').description('Create a governance proposal')
  .requiredOption('--title <text>')
  .requiredOption('--desc <text>')
  .option('--days <n>', 'Voting duration in days', '7')
  .action(async (opts) => {
    const config = loadConfig();
    const hedera = new HederaClient(config.hedera);
    const governance = new Governance(hedera, config.contracts.governanceToken, config.topics.governanceTopicId);
    const id = await governance.createProposal(opts.title, opts.desc, parseInt(opts.days));
    console.log(chalk.green(`✓ Proposal created: ${id}`));
  });

govCmd.command('vote').description('Vote on a proposal')
  .argument('<proposalId>')
  .option('--for', 'Vote for')
  .option('--amount <hbar>', 'HBAR to stake', '1')
  .action(async (proposalId, opts) => {
    const config = loadConfig();
    const hedera = new HederaClient(config.hedera);
    const governance = new Governance(hedera, config.contracts.governanceToken, config.topics.governanceTopicId);
    await governance.vote(proposalId, Boolean(opts.for), opts.amount);
    console.log(chalk.green(`✓ Vote cast`));
  });

program.command('balance').description('Check HBAR balance').action(async () => {
  const config = loadConfig();
  const hedera = new HederaClient(config.hedera);
  const bal = await hedera.getAccountBalance();
  console.log(chalk.green(`Account: ${config.hedera.accountId}`));
  console.log(chalk.blue(`Balance: ${bal.hbar} HBAR`));
});

program.command('info').description('Show current config').action(() => {
  try {
    const config = loadConfig();
    console.log(chalk.bold('\nNexusChain Config'));
    console.log(`Network: ${chalk.cyan(config.hedera.network)}`);
    console.log(`Account: ${chalk.cyan(config.hedera.accountId)}`);
    console.log(`Manifest Topic: ${chalk.cyan(config.topics.manifestTopicId)}`);
    console.log(`Governance Topic: ${chalk.cyan(config.topics.governanceTopicId)}`);
    console.log(`Marketplace Contract: ${chalk.cyan(config.contracts.marketplace)}`);
  } catch (e) {
    console.log(chalk.red('No config found. Run: nexuschain init'));
  }
});

program.parse();
