import { v4 as uuid } from 'uuid';
import { Counter, Registry } from 'prom-client';
// Prometheus metrics registry - can be shared or per-instance
let _metricsRegistry = null;
function getMetricsRegistry() {
    if (!_metricsRegistry) {
        _metricsRegistry = new Registry();
    }
    return _metricsRegistry;
}
function setMetricsRegistry(registry) {
    _metricsRegistry = registry;
}
// Lazy metric creation - metrics are created when first accessed
let _mpListingsTotal = null;
let _mpPurchasesTotal = null;
let _mpViewsTotal = null;
let _mpRatingEventsTotal = null;
function mpListingsTotal() {
    if (!_mpListingsTotal) {
        _mpListingsTotal = new Counter({
            name: 'marketplace_listings_total',
            help: 'Total number of agent listings created',
            registers: [getMetricsRegistry()],
        });
    }
    return _mpListingsTotal;
}
function mpPurchasesTotal() {
    if (!_mpPurchasesTotal) {
        _mpPurchasesTotal = new Counter({
            name: 'marketplace_purchases_total',
            help: 'Total number of agent purchases',
            registers: [getMetricsRegistry()],
        });
    }
    return _mpPurchasesTotal;
}
function mpViewsTotal() {
    if (!_mpViewsTotal) {
        _mpViewsTotal = new Counter({
            name: 'marketplace_views_total',
            help: 'Total number of listing views',
            registers: [getMetricsRegistry()],
        });
    }
    return _mpViewsTotal;
}
function mpRatingEventsTotal() {
    if (!_mpRatingEventsTotal) {
        _mpRatingEventsTotal = new Counter({
            name: 'marketplace_ratings_total',
            help: 'Total number of rating events',
            labelNames: ['rating'],
            registers: [getMetricsRegistry()],
        });
    }
    return _mpRatingEventsTotal;
}
export { getMetricsRegistry, setMetricsRegistry };
export class Marketplace {
    hedera;
    contractId;
    listings = new Map();
    agentRegistry = new Map();
    constructor(hedera, contractId) {
        this.hedera = hedera;
        this.contractId = contractId;
    }
    /** Register agent metadata for marketplace filtering. */
    registerAgentMetadata(agent) {
        this.agentRegistry.set(agent.id, agent);
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
        mpListingsTotal().inc();
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
        mpPurchasesTotal().inc();
        return txId;
    }
    async getListing(agentId) {
        const listing = Array.from(this.listings.values()).find(l => l.agentId === agentId);
        if (listing) {
            listing.views++;
            mpViewsTotal().inc();
        }
        return listing ?? null;
    }
    async getAllListings() {
        return Array.from(this.listings.values());
    }
    /** Search marketplace with filters (capability, minRating, maxPrice, status). */
    async searchListings(filters, agents) {
        let results = Array.from(this.listings.values());
        // Join with agent metadata for filtering
        const agentMap = new Map(agents.map(a => [a.id, a]));
        if (filters.capability) {
            results = results.filter(l => {
                const agent = agentMap.get(l.agentId);
                return agent?.capabilities.includes(filters.capability) ?? false;
            });
        }
        if (filters.minRating !== undefined) {
            results = results.filter(l => {
                const agent = agentMap.get(l.agentId);
                return (agent?.ratings.average ?? 0) >= filters.minRating;
            });
        }
        if (filters.maxPrice) {
            results = results.filter(l => {
                const priceTinybars = BigInt(l.price);
                const maxTinybars = BigInt(filters.maxPrice);
                return priceTinybars <= maxTinybars;
            });
        }
        if (filters.status) {
            results = results.filter(l => {
                const agent = agentMap.get(l.agentId);
                return agent?.status === filters.status;
            });
        }
        return results.sort((a, b) => {
            // Sort by rating desc, then price asc
            const agentA = agentMap.get(a.agentId);
            const agentB = agentMap.get(b.agentId);
            const ratingDiff = (agentB?.ratings.average ?? 0) - (agentA?.ratings.average ?? 0);
            if (ratingDiff !== 0)
                return ratingDiff;
            return BigInt(a.price) > BigInt(b.price) ? 1 : -1;
        });
    }
    async rateAgent(agentId, rating) {
        await this.hedera.publishMessage(this.contractId, JSON.stringify({
            type: 'AGENT_RATED',
            agentId,
            rating,
            timestamp: new Date().toISOString(),
        }));
        mpRatingEventsTotal().inc({ rating: String(rating) });
    }
    async getRevenue(_agentId) {
        // In production: query contract state for agent's accumulated HBAR
        return '0';
    }
    /** Expose metrics registry for Prometheus scraping. */
    getMetricsRegistry() {
        return getMetricsRegistry();
    }
}
//# sourceMappingURL=marketplace.js.map