import { describe, it, expect, beforeEach } from 'vitest';
import { Marketplace } from '../src/marketplace.js';
import { makeMockHedera, type MockHedera } from './_mocks.js';

describe('Marketplace', () => {
  let hedera: MockHedera;
  let mp: Marketplace;

  beforeEach(() => {
    hedera = makeMockHedera();
    mp = new Marketplace(hedera as any, '0.0.67890');
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
    // a.views already reflects the increment from the first call
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
});
