import { HederaClient } from './hedera/client.js';
import type { MarketplaceListing } from './types.js';
export declare class Marketplace {
    private hedera;
    private contractId;
    private listings;
    constructor(hedera: HederaClient, contractId: string);
    listAgent(agentId: string, price: string): Promise<string>;
    purchaseAgent(agentId: string, buyerId: string): Promise<string>;
    getListing(agentId: string): Promise<MarketplaceListing | null>;
    getAllListings(): Promise<MarketplaceListing[]>;
    rateAgent(agentId: string, rating: number): Promise<void>;
    getRevenue(_agentId: string): Promise<string>;
}
//# sourceMappingURL=marketplace.d.ts.map