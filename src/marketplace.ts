import { HederaClient } from './hedera/client.js';
import type { MarketplaceListing, AgentMetadata } from './types.js';
import { v4 as uuid } from 'uuid';

export class Marketplace {
  private hedera: HederaClient;
  private contractId: string;
  private listings = new Map<string, MarketplaceListing>();

  constructor(hedera: HederaClient, contractId: string) {
    this.hedera = hedera;
    this.contractId = contractId;
  }

  async listAgent(agentId: string, price: string): Promise<string> {
    const listingId = uuid();
    const listing: MarketplaceListing = {
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

  async purchaseAgent(agentId: string, buyerId: string): Promise<string> {
    const listing = Array.from(this.listings.values()).find(l => l.agentId === agentId);
    if (!listing) throw new Error(`Agent ${agentId} not listed`);
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

  async getListing(agentId: string): Promise<MarketplaceListing | null> {
    const listing = Array.from(this.listings.values()).find(l => l.agentId === agentId);
    if (listing) listing.views++;
    return listing ?? null;
  }

  async getAllListings(): Promise<MarketplaceListing[]> {
    return Array.from(this.listings.values());
  }

  async rateAgent(agentId: string, rating: number): Promise<void> {
    await this.hedera.publishMessage(this.contractId, JSON.stringify({
      type: 'AGENT_RATED',
      agentId,
      rating,
      timestamp: new Date().toISOString(),
    }));
  }

  async getRevenue(agentId: string): Promise<string> {
    // In production: query contract state for agent's accumulated HBAR
    return '0';
  }
}
