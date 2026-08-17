import { describe, it, expect, beforeEach } from 'vitest';
import { Marketplace, resetMetricsRegistry } from '../src/marketplace.js';
import { makeMockHedera, type MockHedera } from './_mocks.js';
import type { AgentMetadata, AgentFilter } from '../src/types.js';

function makeAgent(overrides: Partial<AgentMetadata> = {}): AgentMetadata {
  return {
    id: 'placeholder',
    name: 'Agent X',
    description: 'A test agent',
    ownerId: '0.0.1001',
    version: '1.0.0',
    pricing: { currency: 'HBAR', pricePerCall: '1000000', subscriptionTiers: [] },
    capabilities: ['code-gen', 'text-analysis'],
    ipfsCid: 'bafytest',
    hcsTopicId: '0.0.5555',
    status: 'active',
    ratings: { average: 0, count: 0 },
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('Marketplace', () => {
  let hedera: MockHedera;
  let mp: Marketplace;

  beforeEach(() => {
    hedera = makeMockHedera();
    mp = new Marketplace(hedera as any, '0.0.67890');
    resetMetricsRegistry();
  });

  it('listAgent stores a listing and returns a uuid', async () => {
    const id = await mp.listAgent('agent-1', '5000000');
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    const all = await mp.getAllListings();
    expect(all).toHaveLength(1);
    expect(all[0].agentId).toBe('agent-1');
    expect(all[0].price).toBe('5000000');
    expect(all[0].currency).toBe('HBAR');
  });

  it('purchaseAgent emits AGENT_PURCHASED and returns a txId', async () => {
    await mp.listAgent('agent-1', '1000000');
    const txId = await mp.purchaseAgent('agent-1', '0.0.9999');
    expect(txId).toMatch(/^purchase_[0-9a-f-]{36}$/);
    expect(hedera.publishMessage).toHaveBeenCalledTimes(1);
    const [topicId, payload] = hedera.publishMessage.mock.calls[0];
    expect(topicId).toBe('0.0.67890');
    const evt = JSON.parse(payload);
    expect(evt.type).toBe('AGENT_PURCHASED');
    expect(evt.agentId).toBe('agent-1');
    expect(evt.buyerId).toBe('0.0.9999');
    expect(evt.price).toBe('1000000');
  });

  it('purchaseAgent throws when agent is not listed', async () => {
    await expect(mp.purchaseAgent('missing', '0.0.9999')).rejects.toThrow('not listed');
  });

  it('getListing increments views on hit', async () => {
    await mp.listAgent('agent-1', '1000');
    const a = await mp.getListing('agent-1');
    expect(a?.views).toBe(1);
    const b = await mp.getListing('agent-1');
    expect(b?.views).toBe(2);
  });

  it('getListing returns null for unknown agents', async () => {
    expect(await mp.getListing('ghost')).toBeNull();
  });

  it('rateAgent publishes AGENT_RATED', async () => {
    await mp.rateAgent('agent-1', 5);
    const [topicId, payload] = hedera.publishMessage.mock.calls[0];
    expect(topicId).toBe('0.0.67890');
    const evt = JSON.parse(payload);
    expect(evt.type).toBe('AGENT_RATED');
    expect(evt.agentId).toBe('agent-1');
    expect(evt.rating).toBe(5);
  });

  it('getRevenue returns "0" placeholder (live contract integration pending)', async () => {
    expect(await mp.getRevenue('agent-1')).toBe('0');
  });

  // --- Search / Filter Tests ---
  describe('searchListings', () => {
    let agent1: string, agent2: string, agent3: string;
    let agents: AgentMetadata[];

    beforeEach(async () => {
      // Register agent metadata for filtering
      agent1 = 'agent-1';
      agent2 = 'agent-2';
      agent3 = 'agent-3';

      agents = [
        makeAgent({ id: agent1, name: 'CodeGen Pro', capabilities: ['code-gen', 'text-analysis'], ratings: { average: 4.5, count: 10 } }),
        makeAgent({ id: agent2, name: 'ImageGen Master', capabilities: ['image-gen', 'video-gen'], ratings: { average: 3.0, count: 5 } }),
        makeAgent({ id: agent3, name: 'TextBot Basic', capabilities: ['text-analysis'], ratings: { average: 2.0, count: 2 } }),
      ];

      for (const agent of agents) {
        mp.registerAgentMetadata(agent);
      }

      // Create listings with different prices
      await mp.listAgent(agent1, '5000000');  // 0.05 HBAR
      await mp.listAgent(agent2, '20000000'); // 0.2 HBAR
      await mp.listAgent(agent3, '1000000');  // 0.01 HBAR
    });

    it('filters by capability', async () => {
      const results = await mp.searchListings({ capability: 'code-gen' }, agents);
      expect(results).toHaveLength(1);
      expect(results[0].agentId).toBe(agent1);
    });

    it('filters by minRating', async () => {
      const results = await mp.searchListings({ minRating: 4.0 }, agents);
      expect(results).toHaveLength(1);
      expect(results[0].agentId).toBe(agent1);
    });

    it('filters by maxPrice (in tinybars)', async () => {
      const results = await mp.searchListings({ maxPrice: '10000000' }, agents); // 0.1 HBAR max
      expect(results).toHaveLength(2);
      // agent1 (rating 4.5) comes before agent3 (rating 2.0) due to rating desc sort
      expect(results.map(r => r.agentId)).toEqual([agent1, agent3]);
    });

    it('filters by status', async () => {
      const results = await mp.searchListings({ status: 'active' }, agents);
      expect(results).toHaveLength(3);

      // Deactivate one agent and test again
      agents[1] = { ...agents[1], status: 'deprecated' };
      const results2 = await mp.searchListings({ status: 'active' }, agents);
      expect(results2).toHaveLength(2);
      expect(results2.map(r => r.agentId)).not.toContain(agent2);
    });

    it('combines multiple filters', async () => {
      const results = await mp.searchListings(
        { capability: 'text-analysis', minRating: 3.0, maxPrice: '10000000' },
        agents
      );
      expect(results).toHaveLength(1);
      expect(results[0].agentId).toBe(agent1);
    });

    it('sorts by rating descending, then price ascending', async () => {
      // Add another agent with same rating as agent1 but lower price
      const agent4 = 'agent-4';
      const agent4Meta = makeAgent({ id: agent4, name: 'CheapCoder', capabilities: ['code-gen'], ratings: { average: 4.5, count: 3 } });
      mp.registerAgentMetadata(agent4Meta);
      await mp.listAgent(agent4, '1000000'); // cheaper than agent1
      agents.push(agent4Meta);

      const results = await mp.searchListings({ capability: 'code-gen' }, agents);
      expect(results).toHaveLength(2);
      // Both have 4.5 rating, so cheaper one (agent4) should come first
      expect(results[0].agentId).toBe(agent4);
      expect(results[1].agentId).toBe(agent1);
    });

    it('returns empty array when no matches', async () => {
      const results = await mp.searchListings({ capability: 'non-existent' }, agents);
      expect(results).toHaveLength(0);
    });

    it('returns all listings when no filters provided', async () => {
      const results = await mp.searchListings({}, agents);
      expect(results).toHaveLength(3);
    });
  });

  // --- Purchase Flow Integration Tests ---
  describe('Purchase Flow Integration', () => {
    it('completes full purchase flow: list -> purchase -> rate -> view listing', async () => {
      // 1. List an agent
      const listingId = await mp.listAgent('agent-1', '5000000');
      expect(listingId).toMatch(/^[0-9a-f-]{36}$/);

      // 2. Purchase the agent
      const txId = await mp.purchaseAgent('agent-1', '0.0.9999');
      expect(txId).toMatch(/^purchase_[0-9a-f-]{36}$/);

      // Verify purchase event was published
      const purchaseCall = hedera.publishMessage.mock.calls.find(
        ([, payload]) => JSON.parse(payload).type === 'AGENT_PURCHASED'
      );
      expect(purchaseCall).toBeDefined();
      const purchaseEvt = JSON.parse(purchaseCall![1]);
      expect(purchaseEvt.agentId).toBe('agent-1');
      expect(purchaseEvt.buyerId).toBe('0.0.9999');
      expect(purchaseEvt.price).toBe('5000000');

      // 3. Rate the agent
      await mp.rateAgent('agent-1', 5);
      const rateCall = hedera.publishMessage.mock.calls.find(
        ([, payload]) => JSON.parse(payload).type === 'AGENT_RATED'
      );
      expect(rateCall).toBeDefined();
      const rateEvt = JSON.parse(rateCall![1]);
      expect(rateEvt.agentId).toBe('agent-1');
      expect(rateEvt.rating).toBe(5);

      // 4. View listing (increments views)
      const listing = await mp.getListing('agent-1');
      expect(listing).not.toBeNull();
      expect(listing!.views).toBe(1); // first view increments to 1
    });

    it('handles multiple purchases and ratings correctly', async () => {
      await mp.listAgent('agent-1', '1000000');

      // Multiple buyers purchase
      await mp.purchaseAgent('agent-1', '0.0.1111');
      await mp.purchaseAgent('agent-1', '0.0.2222');
      await mp.purchaseAgent('agent-1', '0.0.3333');

      // Verify all purchase events
      const purchaseEvents = hedera.publishMessage.mock.calls
        .map(([, payload]) => JSON.parse(payload))
        .filter(e => e.type === 'AGENT_PURCHASED');
      expect(purchaseEvents).toHaveLength(3);

      // Multiple ratings
      await mp.rateAgent('agent-1', 4);
      await mp.rateAgent('agent-1', 5);
      await mp.rateAgent('agent-1', 3);

      const rateEvents = hedera.publishMessage.mock.calls
        .map(([, payload]) => JSON.parse(payload))
        .filter(e => e.type === 'AGENT_RATED');
      expect(rateEvents).toHaveLength(3);
      expect(rateEvents.map(e => e.rating)).toEqual([4, 5, 3]);
    });

    it('throws when attempting to purchase unlisted agent', async () => {
      await expect(mp.purchaseAgent('unlisted-agent', '0.0.9999')).rejects.toThrow('not listed');
    });
  });

  // --- Metrics Tests ---
  describe('Prometheus Metrics', () => {
    it('increments listings_total counter on listAgent', async () => {
      // Ensure metrics are created by doing operations first
      await mp.listAgent('agent-1', '1000000');
      await mp.listAgent('agent-2', '2000000');

      const registry = mp.getMetricsRegistry();
      const counter = registry.getSingleMetric('marketplace_listings_total') as any;
      const value = counter?.hashMap?.['']?.value ?? 0;
      expect(value).toBe(2);
    });

    it('increments purchases_total counter on purchaseAgent', async () => {
      await mp.listAgent('agent-1', '1000000');
      
      // Ensure metrics are created
      await mp.purchaseAgent('agent-1', '0.0.9999');
      await mp.purchaseAgent('agent-1', '0.0.8888');

      const registry = mp.getMetricsRegistry();
      const counter = registry.getSingleMetric('marketplace_purchases_total') as any;
      const value = counter?.hashMap?.['']?.value ?? 0;
      expect(value).toBe(2);
    });

    it('increments views_total counter on getListing', async () => {
      await mp.listAgent('agent-1', '1000000');
      
      // Ensure metrics are created
      await mp.getListing('agent-1');
      await mp.getListing('agent-1');

      const registry = mp.getMetricsRegistry();
      const counter = registry.getSingleMetric('marketplace_views_total');
      const value = counter?.hashMap?.['']?.value ?? 0;
      expect(value).toBe(2);
    });

    it('increments ratings_total counter with rating label on rateAgent', async () => {
      // Ensure metrics are created
      await mp.rateAgent('agent-1', 5);
      await mp.rateAgent('agent-1', 3);

      const registry = mp.getMetricsRegistry();
      const counter = registry.getSingleMetric('marketplace_ratings_total');
      const value = counter?.hashMap ? Object.values(counter.hashMap).reduce((sum, v) => sum + Number(v.value), 0) : 0;
      expect(value).toBe(2);
    });
  });
});
