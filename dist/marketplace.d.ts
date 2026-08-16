import { HederaClient } from './hedera/client.js';
import type { MarketplaceListing, AgentFilter, AgentMetadata } from './types.js';
import { Registry } from 'prom-client';
export declare class Marketplace {
    private hedera;
    private contractId;
    private listings;
    private agentRegistry;
    constructor(hedera: HederaClient, contractId: string);
    /** Register agent metadata for marketplace filtering. */
    registerAgentMetadata(agent: AgentMetadata): void;
    listAgent(agentId: string, price: string): Promise<string>;
    purchaseAgent(agentId: string, buyerId: string): Promise<string>;
    getListing(agentId: string): Promise<MarketplaceListing | null>;
    getAllListings(): Promise<MarketplaceListing[]>;
    /** Search marketplace with filters (capability, minRating, maxPrice, status). */
    searchListings(filters: AgentFilter, agents: AgentMetadata[]): Promise<MarketplaceListing[]>;
    rateAgent(agentId: string, rating: number): Promise<void>;
    getRevenue(_agentId: string): Promise<string>;
    /** Expose metrics registry for Prometheus scraping. */
    getMetricsRegistry(): Registry;
}
//# sourceMappingURL=marketplace.d.ts.map