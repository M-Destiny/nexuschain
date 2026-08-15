export interface SubscriptionTier {
  name: string;
  pricePerMonth: string; // in HBAR tinybars
  callsPerMonth: number;
  features: string[];
}

export interface AgentPricing {
  currency: 'HBAR' | 'USD';
  pricePerCall: string;
  subscriptionTiers: SubscriptionTier[];
}

export interface AgentMetadata {
  id: string;
  name: string;
  description: string;
  ownerId: string;
  version: string;
  pricing: AgentPricing;
  capabilities: string[]; // e.g. ['code-gen', 'image-gen', 'text-analysis']
  ipfsCid: string;
  hcsTopicId: string;
  status: 'active' | 'paused' | 'deprecated';
  ratings: { average: number; count: number };
  createdAt: string;
  updatedAt: string;
}

export interface MarketplaceListing {
  agentId: string;
  listingId: string;
  price: string;
  currency: 'HBAR';
  createdAt: string;
  views: number;
}

export interface UsageRecord {
  userId: string;
  agentId: string;
  calls: number;
  hbarSpent: string;
  timestamp: string;
}

export interface GovernanceProposal {
  id: string;
  title: string;
  description: string;
  forVotes: string;
  againstVotes: string;
  status: 'active' | 'passed' | 'rejected' | 'executed';
  createdBy: string;
  deadline: string;
  quorum: string;
  transactionHash?: string;
}

export interface HederaConfig {
  accountId: string;
  privateKey: string;
  network: 'mainnet' | 'testnet' | 'previewnet';
}

export interface ContractAddresses {
  marketplace: string;
  governanceToken: string;
  agentToken?: string;
}

export interface NexusChainConfig {
  hedera: HederaConfig;
  contracts: ContractAddresses;
  topics: {
    manifestTopicId: string;
    governanceTopicId: string;
    usageTopicId: string;
  };
  ipfs?: {
    pinataJwt?: string;
    web3StorageToken?: string;
  };
}

export interface AgentFilter {
  capability?: string;
  minRating?: number;
  maxPrice?: string;
  status?: AgentMetadata['status'];
}
