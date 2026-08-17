import { describe, it, expect, beforeEach } from 'vitest';
import { Marketplace } from '../src/marketplace.js';
import { AgentRegistry } from '../src/agent-registry.js';
import { makeMockHedera, type MockHedera } from './_mocks.js';
import type { AgentMetadata } from '../src/types.js';

function makeAgent(overrides: Partial<AgentMetadata> = {}): AgentMetadata {
  return {
    id: 'placeholder',
    name: 'Integration Agent',
    description: 'A test agent for integration testing',
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

function registerArgs(overrides: Partial<AgentMetadata> = {}) {
  const { id: _drop, ...rest } = makeAgent(overrides);
  void _drop;
  return [rest, 'priv-key'] as const;
}

describe('Marketplace Integration (AgentRegistry + Marketplace)', () => {
  let hedera: MockHedera;
  let registry: AgentRegistry;
  let marketplace: Marketplace;

  beforeEach(() => {
    hedera = makeMockHedera();
    registry = new AgentRegistry(hedera as any, '0.0.5555');
    marketplace = new Marketplace(hedera as any, '0.0.67890');
  });

  it('full flow: register agent -> list on marketplace -> purchase -> rate', async () => {
    // 1. Register agent via AgentRegistry
    const [args, key] = registerArgs({ name: 'CodeGen Pro', capabilities: ['code-gen', 'refactoring'] });
    const agentId = await registry.registerAgent(args, key);
    expect(agentId).toMatch(/^[0-9a-f-]{36}$/);

    // 2. Register agent metadata in marketplace for filtering
    const agent = await registry.getAgent(agentId);
    expect(agent).not.toBeNull();
    marketplace.registerAgentMetadata(agent!);

    // 3. List agent on marketplace
    const listingId = await marketplace.listAgent(agentId, '5000000'); // 0.05 HBAR
    expect(listingId).toMatch(/^[0-9a-f-]{36}$/);

    // 4. Verify listing exists and has correct data
    const listing = await marketplace.getListing(agentId);
    expect(listing).not.toBeNull();
    expect(listing!.agentId).toBe(agentId);
    expect(listing!.price).toBe('5000000');
    expect(listing!.currency).toBe('HBAR');
    expect(listing!.views).toBe(1); // First getListing increments views

    // 5. Purchase the agent
    const buyerId = '0.0.9999';
    const txId = await marketplace.purchaseAgent(agentId, buyerId);
    expect(txId).toMatch(/^purchase_[0-9a-f-]{36}$/);

    // 6. Verify AGENT_PURCHASED event was published
    const purchaseCall = hedera.publishMessage.mock.calls.find(
      (call) => JSON.parse(call[1]).type === 'AGENT_PURCHASED'
    );
    expect(purchaseCall).toBeDefined();
    const purchaseEvt = JSON.parse(purchaseCall![1]);
    expect(purchaseEvt.agentId).toBe(agentId);
    expect(purchaseEvt.buyerId).toBe(buyerId);
    expect(purchaseEvt.price).toBe('5000000');

    // 7. Rate the agent
    await marketplace.rateAgent(agentId, 5);
    const rateCall = hedera.publishMessage.mock.calls.find(
      (call) => JSON.parse(call[1]).type === 'AGENT_RATED'
    );
    expect(rateCall).toBeDefined();
    const rateEvt = JSON.parse(rateCall![1]);
    expect(rateEvt.agentId).toBe(agentId);
    expect(rateEvt.rating).toBe(5);

    // 8. Verify view count incremented on second getListing
    const listing2 = await marketplace.getListing(agentId);
    expect(listing2!.views).toBe(2);
  });

  it('searchListings filters by capability, rating, price, and status', async () => {
    // Register multiple agents with different capabilities and ratings
    const [args1, key1] = registerArgs({ name: 'Agent A', capabilities: ['code-gen'] });
    const agentId1 = await registry.registerAgent(args1, key1);
    await registry.rateAgent(agentId1, 5);
    await registry.rateAgent(agentId1, 4);
    marketplace.registerAgentMetadata((await registry.getAgent(agentId1))!);

    const [args2, key2] = registerArgs({ name: 'Agent B', capabilities: ['image-gen'] });
    const agentId2 = await registry.registerAgent(args2, key2);
    await registry.rateAgent(agentId2, 3);
    marketplace.registerAgentMetadata((await registry.getAgent(agentId2))!);

    const [args3, key3] = registerArgs({ name: 'Agent C', capabilities: ['code-gen', 'text-analysis'] });
    const agentId3 = await registry.registerAgent(args3, key3);
    await registry.rateAgent(agentId3, 5);
    marketplace.registerAgentMetadata((await registry.getAgent(agentId3))!);

    // List all three at different prices
    await marketplace.listAgent(agentId1, '10000000'); // 0.1 HBAR
    await marketplace.listAgent(agentId2, '5000000');  // 0.05 HBAR
    await marketplace.listAgent(agentId3, '20000000'); // 0.2 HBAR

    const allAgents = await registry.listAgents();

    // Filter by capability: code-gen
    const codeGenResults = await marketplace.searchListings({ capability: 'code-gen' }, allAgents);
    expect(codeGenResults.map((l) => l.agentId)).toEqual(expect.arrayContaining([agentId1, agentId3]));
    expect(codeGenResults.map((l) => l.agentId)).not.toContain(agentId2);

    // Filter by minRating: >= 4.5
    const highRated = await marketplace.searchListings({ minRating: 4.5 }, allAgents);
    expect(highRated.map((l) => l.agentId)).toEqual(expect.arrayContaining([agentId1, agentId3]));
    expect(highRated.map((l) => l.agentId)).not.toContain(agentId2);

    // Filter by maxPrice: <= 0.15 HBAR (15000000 tinybars)
    const affordable = await marketplace.searchListings({ maxPrice: '15000000' }, allAgents);
    expect(affordable.map((l) => l.agentId)).toEqual(expect.arrayContaining([agentId1, agentId2]));
    expect(affordable.map((l) => l.agentId)).not.toContain(agentId3);

    // Combined filters: code-gen AND minRating 4.5 AND maxPrice 0.15 HBAR
    const combined = await marketplace.searchListings(
      { capability: 'code-gen', minRating: 4.5, maxPrice: '15000000' },
      allAgents
    );
    expect(combined.map((l) => l.agentId)).toEqual([agentId1]);
  });

  it('searchListings sorts by rating desc then price asc', async () => {
    const [args1, key1] = registerArgs({ name: 'LowRating', capabilities: ['code-gen'] });
    const agentId1 = await registry.registerAgent(args1, key1);
    await registry.rateAgent(agentId1, 2);
    marketplace.registerAgentMetadata((await registry.getAgent(agentId1))!);

    const [args2, key2] = registerArgs({ name: 'HighRating', capabilities: ['code-gen'] });
    const agentId2 = await registry.registerAgent(args2, key2);
    await registry.rateAgent(agentId2, 5);
    marketplace.registerAgentMetadata((await registry.getAgent(agentId2))!);

    const [args3, key3] = registerArgs({ name: 'HighRatingCheap', capabilities: ['code-gen'] });
    const agentId3 = await registry.registerAgent(args3, key3);
    await registry.rateAgent(agentId3, 5);
    marketplace.registerAgentMetadata((await registry.getAgent(agentId3))!);

    await marketplace.listAgent(agentId1, '10000000'); // 0.1 HBAR
    await marketplace.listAgent(agentId2, '20000000'); // 0.2 HBAR
    await marketplace.listAgent(agentId3, '5000000');  // 0.05 HBAR

    const allAgents = await registry.listAgents();
    const results = await marketplace.searchListings({ capability: 'code-gen' }, allAgents);

    // HighRatingCheap (rating 5, price 0.05) should be first
    // HighRating (rating 5, price 0.2) should be second
    // LowRating (rating 2, price 0.1) should be third
    expect(results[0].agentId).toBe(agentId3);
    expect(results[1].agentId).toBe(agentId2);
    expect(results[2].agentId).toBe(agentId1);
  });

  it('purchaseAgent throws when agent not listed', async () => {
    const [args, key] = registerArgs();
    const agentId = await registry.registerAgent(args, key);
    marketplace.registerAgentMetadata((await registry.getAgent(agentId))!);

    // Agent registered but NOT listed
    await expect(marketplace.purchaseAgent(agentId, '0.0.9999')).rejects.toThrow('not listed');
  });

  it('getRevenue returns placeholder (contract integration pending)', async () => {
    const [args, key] = registerArgs();
    const agentId = await registry.registerAgent(args, key);
    expect(await marketplace.getRevenue(agentId)).toBe('0');
  });

  it('metrics registry is accessible and has expected counters', async () => {
    const metricsRegistry = marketplace.getMetricsRegistry();
    expect(metricsRegistry).toBeDefined();

    const metrics = await metricsRegistry.metrics();
    expect(metrics).toContain('marketplace_listings_total');
    expect(metrics).toContain('marketplace_purchases_total');
    expect(metrics).toContain('marketplace_views_total');
    expect(metrics).toContain('marketplace_ratings_total');
  });
});