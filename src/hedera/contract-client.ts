/**
 * ContractClient — Type-safe ethers.js wrapper for NexusChainMarketplace.sol
 *
 * Provides on-chain operations that the HCS-only Marketplace class cannot:
 *   - Actual HBAR transfers via payable purchaseAgent()
 *   - Contract state reads (listings, agents, revenue)
 *   - Governance actions that mutate contract storage
 *   - Event filtering for indexer-friendly consumption
 *   - Prometheus metrics for on-chain events
 *
 * Usage:
 *   const contract = new ContractClient(config.contracts.marketplace, hederaClient);
 *   await contract.listAgent('agent-1', '5000000'); // 0.05 HBAR in tinybars
 *   await contract.purchaseAgent('agent-1', { value: '6000000' }); // pay 0.06 HBAR
 *   const listing = await contract.getListing('agent-1');
 */
import { ethers, Contract, Interface, LogDescription, Log } from 'ethers';
import { HederaClient } from './client.js';
import type { ContractAddresses } from '../types.js';
import { Counter, Histogram, Registry } from 'prom-client';

// Prometheus metrics registry
let _contractMetricsRegistry: Registry | null = null;

function getContractMetricsRegistry(): Registry {
  if (!_contractMetricsRegistry) {
    _contractMetricsRegistry = new Registry();
  }
  return _contractMetricsRegistry;
}

function setContractMetricsRegistry(registry: Registry): void {
  _contractMetricsRegistry = registry;
}

/** Reset the shared metrics registry (for testing only). */
export function resetContractMetricsRegistry(): void {
  _contractMetricsRegistry = null;
  _ccAgentRegisteredTotal = null;
  _ccAgentPurchasedTotal = null;
  _ccAgentRatedTotal = null;
  _ccAgentUpgradedTotal = null;
  _ccProposalCreatedTotal = null;
  _ccVoteCastTotal = null;
  _ccProposalExecutedTotal = null;
  _ccTxLatency = null;
}

// Lazy metric creation
let _ccAgentRegisteredTotal: Counter | null = null;
let _ccAgentPurchasedTotal: Counter | null = null;
let _ccAgentRatedTotal: Counter | null = null;
let _ccAgentUpgradedTotal: Counter | null = null;
let _ccProposalCreatedTotal: Counter | null = null;
let _ccVoteCastTotal: Counter | null = null;
let _ccProposalExecutedTotal: Counter | null = null;
let _ccTxLatency: Histogram | null = null;

function ccAgentRegisteredTotal(): Counter {
  if (!_ccAgentRegisteredTotal) {
    _ccAgentRegisteredTotal = new Counter({
      name: 'contractclient_agent_registered_total',
      help: 'Total number of agents registered on-chain',
      registers: [getContractMetricsRegistry()],
    });
  }
  return _ccAgentRegisteredTotal;
}

function ccAgentPurchasedTotal(): Counter {
  if (!_ccAgentPurchasedTotal) {
    _ccAgentPurchasedTotal = new Counter({
      name: 'contractclient_agent_purchased_total',
      help: 'Total number of agent purchases on-chain',
      registers: [getContractMetricsRegistry()],
    });
  }
  return _ccAgentPurchasedTotal;
}

function ccAgentRatedTotal(): Counter {
  if (!_ccAgentRatedTotal) {
    _ccAgentRatedTotal = new Counter({
      name: 'contractclient_agent_rated_total',
      help: 'Total number of agent ratings on-chain',
      labelNames: ['rating'],
      registers: [getContractMetricsRegistry()],
    });
  }
  return _ccAgentRatedTotal;
}

function ccAgentUpgradedTotal(): Counter {
  if (!_ccAgentUpgradedTotal) {
    _ccAgentUpgradedTotal = new Counter({
      name: 'contractclient_agent_upgraded_total',
      help: 'Total number of agent upgrades on-chain',
      registers: [getContractMetricsRegistry()],
    });
  }
  return _ccAgentUpgradedTotal;
}

function ccProposalCreatedTotal(): Counter {
  if (!_ccProposalCreatedTotal) {
    _ccProposalCreatedTotal = new Counter({
      name: 'contractclient_proposal_created_total',
      help: 'Total number of governance proposals created on-chain',
      registers: [getContractMetricsRegistry()],
    });
  }
  return _ccProposalCreatedTotal;
}

function ccVoteCastTotal(): Counter {
  if (!_ccVoteCastTotal) {
    _ccVoteCastTotal = new Counter({
      name: 'contractclient_vote_cast_total',
      help: 'Total number of votes cast on-chain',
      labelNames: ['support'],
      registers: [getContractMetricsRegistry()],
    });
  }
  return _ccVoteCastTotal;
}

function ccProposalExecutedTotal(): Counter {
  if (!_ccProposalExecutedTotal) {
    _ccProposalExecutedTotal = new Counter({
      name: 'contractclient_proposal_executed_total',
      help: 'Total number of governance proposals executed on-chain',
      labelNames: ['passed'],
      registers: [getContractMetricsRegistry()],
    });
  }
  return _ccProposalExecutedTotal;
}

function ccTxLatency(): Histogram {
  if (!_ccTxLatency) {
    _ccTxLatency = new Histogram({
      name: 'contractclient_tx_latency_seconds',
      help: 'Latency of on-chain transactions in seconds',
      labelNames: ['method'],
      buckets: [0.1, 0.5, 1, 2, 5, 10, 30, 60],
      registers: [getContractMetricsRegistry()],
    });
  }
  return _ccTxLatency;
}

export { getContractMetricsRegistry, setContractMetricsRegistry };

// NexusChainMarketplace.sol ABI (subset - extend as contract evolves)
const MARKETPLACE_ABI = [
  // Agent Registry
  'function registerAgent(string memory id, string memory name, string memory description, uint256 pricePerCall, string memory ipfsCid, string[] memory capabilities, SubscriptionTier[] memory subscriptionTiers, string memory version) external',
  'function updateAgent(string memory id, uint256 newPrice, bool deactivate) external',
  'function updateSubscriptionTiers(string memory id, SubscriptionTier[] memory tiers) external',
  'function getAgent(string memory id) external view returns (tuple(string id, string name, string description, address payable owner, uint256 pricePerCall, uint256 ratingSum, uint256 ratingCount, bool isActive, string ipfsCid, string[] capabilities, SubscriptionTier[] subscriptionTiers, string version))',
  'function getSubscriptionTiers(string memory id) external view returns (SubscriptionTier[] memory)',

  // Marketplace
  'function listAgent(string memory agentId, uint256 price) external',
  'function purchaseAgent(string memory agentId) external payable',
  'function rateAgent(string memory agentId, uint8 rating) external',
  'function getAverageRating(string memory agentId) external view returns (uint256)',
  'function upgradeAgent(string memory id, string memory newVersion, string memory newIpfsCid) external',

  // Governance
  'function createProposal(string memory id, string memory title, string memory description, uint256 durationDays) external',
  'function vote(string memory proposalId, bool support, uint256 amount) external',
  'function executeProposal(string memory proposalId) external',
  'function proposals(string memory id) external view returns (tuple(string id, string title, string description, uint256 forVotes, uint256 againstVotes, uint256 deadline, bool executed, bool exists))',

  // Treasury
  'function withdrawTreasury(address payable recipient) external',
  'function setTreasury(address newTreasury) external',
  'function treasury() external view returns (address)',
  'function agentRevenue(string memory agentId) external view returns (uint256)',

  // Events
  'event AgentRegistered(string indexed id, string name, address indexed owner, uint256 price)',
  'event AgentListed(string indexed agentId, uint256 price)',
  'event AgentPurchased(string indexed agentId, address indexed buyer, uint256 price, address indexed seller)',
  'event AgentRated(string indexed agentId, uint8 rating, address indexed rater)',
  'event AgentDeactivated(string indexed agentId)',
  'event AgentUpgraded(string indexed id, string fromVersion, string toVersion, string ipfsCid)',
  'event ProposalCreated(string indexed id, string title, uint256 deadline)',
  'event VoteCast(string indexed proposalId, address indexed voter, bool support, uint256 amount)',
  'event ProposalExecuted(string indexed proposalId, bool passed)',

  // Types
  'struct SubscriptionTier { string name; uint256 pricePerMonth; uint256 callsPerMonth; string[] features; bool isActive; }',
] as const;

export interface SubscriptionTierInput {
  name: string;
  pricePerMonth: bigint; // tinybars
  callsPerMonth: bigint;
  features: string[];
  isActive: boolean;
}

export interface AgentOnChain {
  id: string;
  name: string;
  description: string;
  owner: string;
  pricePerCall: bigint;
  ratingSum: bigint;
  ratingCount: bigint;
  isActive: boolean;
  ipfsCid: string;
  capabilities: string[];
  subscriptionTiers: SubscriptionTierOnChain[];
  version: string;
}

export interface SubscriptionTierOnChain {
  name: string;
  pricePerMonth: bigint;
  callsPerMonth: bigint;
  features: string[];
  isActive: boolean;
}

export interface ListingOnChain {
  agentId: string;
  price: bigint;
  views: bigint;
  exists: boolean;
}

export interface ProposalOnChain {
  id: string;
  title: string;
  description: string;
  forVotes: bigint;
  againstVotes: bigint;
  deadline: bigint;
  executed: boolean;
  exists: boolean;
}

export interface PurchaseResult {
  txHash: string;
  blockNumber: number;
  gasUsed: bigint;
  price: bigint;
  seller: string;
}

export interface ContractClientOptions {
  /** Contract address (e.g., '0.0.123456' or '0x...') */
  contractAddress: string;
  /** HederaClient for operator account & network */
  hederaClient: HederaClient;
  /** Optional: custom ethers provider (defaults to Hedera JSON-RPC for network) */
  provider?: ethers.Provider;
  /** Optional: custom signer (defaults to operator account from HederaClient) */
  signer?: ethers.Signer;
}

const NETWORK_RPC = {
  mainnet: 'https://mainnet.hashio.io/api',
  testnet: 'https://testnet.hashio.io/api',
  previewnet: 'https://previewnet.hashio.io/api',
} as const;

function toEthersAddress(hederaId: string): string {
  // Convert '0.0.12345' to '0x000000000000000000000000000000000001e240'
  // Hedera EVM address = right-padded 20 bytes of the account num
  const parts = hederaId.split('.');
  if (parts.length !== 3) {
    // Assume it's already an EVM address
    return hederaId.startsWith('0x') ? hederaId : `0x${hederaId.padStart(40, '0')}`;
  }
  const num = parseInt(parts[2], 10);
  const hex = num.toString(16).padStart(40, '0');
  return `0x${hex}`;
}

function fromEthersAddress(evmAddr: string): string {
  // Convert '0x000000000000000000000000000000000001e240' to '0.0.123456'
  const num = BigInt(evmAddr);
  return `0.0.${num.toString()}`;
}

function parseSubscriptionTier(tier: any): SubscriptionTierOnChain {
  return {
    name: tier[0],
    pricePerMonth: tier[1],
    callsPerMonth: tier[2],
    features: tier[3],
    isActive: tier[4],
  };
}

function parseAgent(data: any): AgentOnChain {
  return {
    id: data[0],
    name: data[1],
    description: data[2],
    owner: fromEthersAddress(data[3]),
    pricePerCall: data[4],
    ratingSum: data[5],
    ratingCount: data[6],
    isActive: data[7],
    ipfsCid: data[8],
    capabilities: data[9],
    subscriptionTiers: data[10].map(parseSubscriptionTier),
    version: data[11],
  };
}

// function parseListing(data: any): ListingOnChain {
//   return {
//     agentId: data[0],
//     price: data[1],
//     views: data[2],
//     exists: data[3],
//   };
// }

function parseProposal(data: any): ProposalOnChain {
  return {
    id: data[0],
    title: data[1],
    description: data[2],
    forVotes: data[3],
    againstVotes: data[4],
    deadline: data[5],
    executed: data[6],
    exists: data[7],
  };
}

/**
 * ContractClient — bridges TypeScript SDK with deployed NexusChainMarketplace.sol
 */
export class ContractClient {
  private contract: Contract;
  private contractAddress: string;
  private hederaClient: HederaClient;
  private iface: Interface;

  constructor(options: ContractClientOptions) {
    this.contractAddress = options.contractAddress;
    this.hederaClient = options.hederaClient;
    this.iface = new Interface(MARKETPLACE_ABI);

    // Create provider if not provided
    const provider = options.provider ?? new ethers.JsonRpcProvider(
      NETWORK_RPC[this.hederaClient.getNetwork() as keyof typeof NETWORK_RPC] ?? NETWORK_RPC.testnet,
    );

    // Create signer if not provided (uses operator private key from HederaClient)
    const signer = options.signer ?? new ethers.Wallet(this.hederaClient['privateKey'], provider);

    this.contract = new Contract(this.contractAddress, MARKETPLACE_ABI, signer);
  }

  /** Get the underlying ethers Contract instance for advanced usage */
  getContract(): Contract {
    return this.contract;
  }

  /** Get the contract's EVM address */
  getAddress(): string {
    return this.contractAddress;
  }

  /** Get the contract's Hedera account ID format */
  getHederaId(): string {
    return fromEthersAddress(this.contractAddress);
  }

  // =========================================================================
  // AGENT REGISTRY (on-chain)
  // =========================================================================

  /** Register an agent on-chain (emits AgentRegistered event) */
  async registerAgent(
    id: string,
    name: string,
    description: string,
    pricePerCall: bigint,
    ipfsCid: string,
    capabilities: string[],
    subscriptionTiers: SubscriptionTierInput[],
    version: string,
  ): Promise<{ txHash: string; blockNumber: number }> {
    const start = Date.now();
    const tx = await this.contract.registerAgent(
      id,
      name,
      description,
      pricePerCall,
      ipfsCid,
      capabilities,
      subscriptionTiers.map(t => [t.name, t.pricePerMonth, t.callsPerMonth, t.features, t.isActive]),
      version,
    );
    const receipt = await tx.wait();
    ccAgentRegisteredTotal().inc();
    ccTxLatency().observe({ method: 'registerAgent' }, (Date.now() - start) / 1000);
    return { txHash: receipt.hash, blockNumber: receipt.blockNumber };
  }

  /** Update agent price or deactivate (owner only) */
  async updateAgent(agentId: string, newPrice: bigint, deactivate = false): Promise<{ txHash: string; blockNumber: number }> {
    const tx = await this.contract.updateAgent(agentId, newPrice, deactivate);
    const receipt = await tx.wait();
    return { txHash: receipt.hash, blockNumber: receipt.blockNumber };
  }

  /** Update subscription tiers (owner only) */
  async updateSubscriptionTiers(agentId: string, tiers: SubscriptionTierInput[]): Promise<{ txHash: string; blockNumber: number }> {
    const tx = await this.contract.updateSubscriptionTiers(
      agentId,
      tiers.map(t => [t.name, t.pricePerMonth, t.callsPerMonth, t.features, t.isActive]),
    );
    const receipt = await tx.wait();
    return { txHash: receipt.hash, blockNumber: receipt.blockNumber };
  }

  /** Get agent metadata from contract storage */
  async getAgent(agentId: string): Promise<AgentOnChain | null> {
    try {
      const data = await this.contract.getAgent(agentId);
      if (!data || data[0] === '') return null;
      return parseAgent(data);
    } catch {
      return null;
    }
  }

  /** Get subscription tiers for an agent */
  async getSubscriptionTiers(agentId: string): Promise<SubscriptionTierOnChain[]> {
    const tiers = await this.contract.getSubscriptionTiers(agentId);
    return tiers.map(parseSubscriptionTier);
  }

  // =========================================================================
  // MARKETPLACE (on-chain)
  // =========================================================================

  /** List an agent for sale at given price in tinybars (owner only) */
  async listAgent(agentId: string, priceTinybars: bigint): Promise<{ txHash: string; blockNumber: number }> {
    const tx = await this.contract.listAgent(agentId, priceTinybars);
    const receipt = await tx.wait();
    return { txHash: receipt.hash, blockNumber: receipt.blockNumber };
  }

  /** Purchase agent access with HBAR payment (payable) */
  async purchaseAgent(agentId: string, valueTinybars: bigint): Promise<PurchaseResult> {
    const start = Date.now();
    const tx = await this.contract.purchaseAgent(agentId, { value: valueTinybars });
    const receipt = await tx.wait();

    // Parse AgentPurchased event from logs
    const purchaseEvent = receipt.logs
      .map((log: Log) => {
        try {
          return this.iface.parseLog({ topics: log.topics, data: log.data });
        } catch {
          return null;
        }
      })
      .find((e: LogDescription | null) => e?.name === 'AgentPurchased');

    ccAgentPurchasedTotal().inc();
    ccTxLatency().observe({ method: 'purchaseAgent' }, (Date.now() - start) / 1000);

    return {
      txHash: receipt.hash,
      blockNumber: receipt.blockNumber,
      gasUsed: receipt.gasUsed,
      price: purchaseEvent?.args?.price ?? valueTinybars,
      seller: purchaseEvent?.args?.seller ?? '',
    };
  }

  /** Rate an agent 1-5 stars */
  async rateAgent(agentId: string, rating: number): Promise<{ txHash: string; blockNumber: number }> {
    const start = Date.now();
    if (rating < 1 || rating > 5) throw new Error('Rating must be 1-5');
    const tx = await this.contract.rateAgent(agentId, rating);
    const receipt = await tx.wait();
    ccAgentRatedTotal().inc({ rating: String(rating) });
    ccTxLatency().observe({ method: 'rateAgent' }, (Date.now() - start) / 1000);
    return { txHash: receipt.hash, blockNumber: receipt.blockNumber };
  }

  /** Get average rating for an agent */
  async getAverageRating(agentId: string): Promise<number> {
    const rating = await this.contract.getAverageRating(agentId);
    return Number(rating);
  }

  /** Upgrade agent to new version + IPFS CID (owner only, version must be higher) */
  async upgradeAgent(agentId: string, newVersion: string, newIpfsCid: string): Promise<{ txHash: string; blockNumber: number }> {
    const start = Date.now();
    const tx = await this.contract.upgradeAgent(agentId, newVersion, newIpfsCid);
    const receipt = await tx.wait();
    ccAgentUpgradedTotal().inc();
    ccTxLatency().observe({ method: 'upgradeAgent' }, (Date.now() - start) / 1000);
    return { txHash: receipt.hash, blockNumber: receipt.blockNumber };
  }

  // =========================================================================
  // GOVERNANCE (on-chain)
  // =========================================================================

  /** Create a governance proposal */
  async createProposal(id: string, title: string, description: string, durationDays: number): Promise<{ txHash: string; blockNumber: number }> {
    const start = Date.now();
    const tx = await this.contract.createProposal(id, title, description, durationDays);
    const receipt = await tx.wait();
    ccProposalCreatedTotal().inc();
    ccTxLatency().observe({ method: 'createProposal' }, (Date.now() - start) / 1000);
    return { txHash: receipt.hash, blockNumber: receipt.blockNumber };
  }

  /** Vote on a proposal with HBAR weight */
  async vote(proposalId: string, support: boolean, amountTinybars: bigint): Promise<{ txHash: string; blockNumber: number }> {
    const start = Date.now();
    const tx = await this.contract.vote(proposalId, support, amountTinybars);
    const receipt = await tx.wait();
    ccVoteCastTotal().inc({ support: String(support) });
    ccTxLatency().observe({ method: 'vote' }, (Date.now() - start) / 1000);
    return { txHash: receipt.hash, blockNumber: receipt.blockNumber };
  }

  /** Execute a proposal after voting ends (if quorum met) */
  async executeProposal(proposalId: string): Promise<{ txHash: string; blockNumber: number; passed: boolean }> {
    const start = Date.now();
    const tx = await this.contract.executeProposal(proposalId);
    const receipt = await tx.wait();

    const execEvent = receipt.logs
      .map((log: Log) => {
        try {
          return this.iface.parseLog({ topics: log.topics, data: log.data });
        } catch {
          return null;
        }
      })
      .find((e: LogDescription | null) => e?.name === 'ProposalExecuted');

    const passed = execEvent?.args?.passed ?? false;
    ccProposalExecutedTotal().inc({ passed: String(passed) });
    ccTxLatency().observe({ method: 'executeProposal' }, (Date.now() - start) / 1000);

    return {
      txHash: receipt.hash,
      blockNumber: receipt.blockNumber,
      passed,
    };
  }

  /** Get proposal state from contract */
  async getProposal(proposalId: string): Promise<ProposalOnChain | null> {
    try {
      const data = await this.contract.proposals(proposalId);
      if (!data || data[0] === '') return null;
      return parseProposal(data);
    } catch {
      return null;
    }
  }

  // =========================================================================
  // TREASURY & REVENUE
  // =========================================================================

  /** Get treasury address */
  async getTreasury(): Promise<string> {
    const addr = await this.contract.treasury();
    return fromEthersAddress(addr);
  }

  /** Set treasury (only callable once, by deployer) */
  async setTreasury(address: string): Promise<{ txHash: string; blockNumber: number }> {
    const tx = await this.contract.setTreasury(toEthersAddress(address));
    const receipt = await tx.wait();
    return { txHash: receipt.hash, blockNumber: receipt.blockNumber };
  }

  /** Withdraw treasury balance (treasury only) */
  async withdrawTreasury(recipient: string): Promise<{ txHash: string; blockNumber: number }> {
    const tx = await this.contract.withdrawTreasury(toEthersAddress(recipient));
    const receipt = await tx.wait();
    return { txHash: receipt.hash, blockNumber: receipt.blockNumber };
  }

  /** Get agent's accumulated revenue (platform fee share) */
  async getAgentRevenue(agentId: string): Promise<bigint> {
    return await this.contract.agentRevenue(agentId);
  }

  // =========================================================================
  // EVENT FILTERING (for indexers / real-time listeners)
  // =========================================================================

  /** Get contract's ethers Interface for custom event parsing */
  getInterface(): Interface {
    return this.iface;
  }

  /** Create a filter for AgentRegistered events */
  filterAgentRegistered(fromBlock?: number, toBlock?: number): ethers.DeferredTopicFilter {
    return this.contract.filters.AgentRegistered(null, null, fromBlock, toBlock);
  }

  /** Create a filter for AgentPurchased events */
  filterAgentPurchased(agentId?: string, fromBlock?: number, toBlock?: number): ethers.DeferredTopicFilter {
    return this.contract.filters.AgentPurchased(agentId, null, null, fromBlock, toBlock);
  }

  /** Create a filter for AgentRated events */
  filterAgentRated(agentId?: string, fromBlock?: number, toBlock?: number): ethers.DeferredTopicFilter {
    return this.contract.filters.AgentRated(agentId, null, fromBlock, toBlock);
  }

  /** Create a filter for ProposalCreated events */
  filterProposalCreated(fromBlock?: number, toBlock?: number): ethers.DeferredTopicFilter {
    return this.contract.filters.ProposalCreated(null, fromBlock, toBlock);
  }

  /** Create a filter for VoteCast events */
  filterVoteCast(proposalId?: string, fromBlock?: number, toBlock?: number): ethers.DeferredTopicFilter {
    return this.contract.filters.VoteCast(proposalId, null, null, fromBlock, toBlock);
  }

  /** Query historical events with a filter */
  async queryEvents(filter: ethers.ContractEventName): Promise<Array<ethers.EventLog | ethers.Log>> {
    return await this.contract.queryFilter(filter);
  }

  /** Listen for new events in real-time (returns unsubscribe function) */
  on(eventName: string, listener: (...args: any[]) => void): () => void {
    this.contract.on(eventName, listener);
    return () => this.contract.off(eventName, listener);
  }

  /** Remove all listeners (cleanup) */
  removeAllListeners(): void {
    this.contract.removeAllListeners();
  }

  /** Expose metrics registry for Prometheus scraping. */
  getMetricsRegistry(): Registry {
    return getContractMetricsRegistry();
  }
}

/**
 * Factory: create ContractClient from NexusChainConfig
 */
export async function createContractClient(
  config: { contracts: ContractAddresses; hedera: { network: 'mainnet' | 'testnet' | 'previewnet' } },
  hederaClient: HederaClient,
): Promise<ContractClient> {
  if (!config.contracts.marketplace) {
    throw new Error('Marketplace contract address not configured');
  }
  return new ContractClient({
    contractAddress: config.contracts.marketplace,
    hederaClient,
  });
}