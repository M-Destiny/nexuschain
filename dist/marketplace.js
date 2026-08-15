import { v4 as uuid } from 'uuid';
export class Marketplace {
    hedera;
    contractId;
    listings = new Map();
    constructor(hedera, contractId) {
        this.hedera = hedera;
        this.contractId = contractId;
    }
    async listAgent(agentId, price) {
        const listingId = uuid();
        const listing = {
            agentId,
            listingId,
            price,
            currency: 'HBAR',
            createdAt: new Date().toISOString(),
            views: 0,
        };
        this.listings.set(listingId, listing);
        return listingId;
    }
    async purchaseAgent(agentId, buyerId) {
        const listing = Array.from(this.listings.values()).find(l => l.agentId === agentId);
        if (!listing)
            throw new Error(`Agent ${agentId} not listed`);
        const txId = `purchase_${uuid()}`; // In production: submit HTS transfer transaction
        await this.hedera.publishMessage(this.contractId, JSON.stringify({
            type: 'AGENT_PURCHASED',
            agentId,
            buyerId,
            price: listing.price,
            txId,
            timestamp: new Date().toISOString(),
        }));
        return txId;
    }
    async getListing(agentId) {
        const listing = Array.from(this.listings.values()).find(l => l.agentId === agentId);
        if (listing)
            listing.views++;
        return listing ?? null;
    }
    async getAllListings() {
        return Array.from(this.listings.values());
    }
    async rateAgent(agentId, rating) {
        await this.hedera.publishMessage(this.contractId, JSON.stringify({
            type: 'AGENT_RATED',
            agentId,
            rating,
            timestamp: new Date().toISOString(),
        }));
    }
    async getRevenue(agentId) {
        // In production: query contract state for agent's accumulated HBAR
        return '0';
    }
}
//# sourceMappingURL=marketplace.js.map