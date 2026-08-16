export interface SubscriptionTier {
    name: string;
    pricePerMonth: string;
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
    capabilities: string[];
    ipfsCid: string;
    hcsTopicId: string;
    status: 'active' | 'paused' | 'deprecated';
    ratings: {
        average: number;
        count: number;
    };
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
    /**
     * After execution, action is queued and becomes executable only after
     * this timestamp. Prevents rushed governance changes being applied the
     * instant a vote closes — gives the community a window to rally / exit.
     */
    executableAt?: string;
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
//# sourceMappingURL=types.d.ts.map