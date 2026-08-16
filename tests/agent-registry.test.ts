import { describe, it, expect, beforeEach } from 'vitest';
import { AgentRegistry } from '../src/agent-registry.js';
import { makeMockHedera, type MockHedera } from './_mocks.js';
import type { AgentMetadata } from '../src/types.js';

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

// Helper: registerAgent takes Omit<AgentMetadata, 'id'>. Strip the placeholder id.
function registerArgs(overrides: Partial<AgentMetadata> = {}) {
  const { id: _drop, ...rest } = makeAgent(overrides);
  void _drop;
  return [rest, 'priv-key'] as const;
}

describe('AgentRegistry', () => {
  let hedera: MockHedera;
  let registry: AgentRegistry;

  beforeEach(() => {
    hedera = makeMockHedera();
    registry = new AgentRegistry(hedera as any, '0.0.5555');
  });

  it('registerAgent assigns a uuid and publishes an AGENT_REGISTERED event', async () => {
    const [args, key] = registerArgs();
    const id = await registry.registerAgent(args, key);
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    expect(hedera.publishMessage).toHaveBeenCalledTimes(1);
    const [topicId, payload] = hedera.publishMessage.mock.calls[0];
    expect(topicId).toBe('0.0.5555');
    const parsed = JSON.parse(payload);
    expect(parsed.type).toBe('AGENT_REGISTERED');
    expect(parsed.id).toBe(id);
    expect(parsed.name).toBe('Agent X');
    expect(parsed.capabilities).toEqual(['code-gen', 'text-analysis']);
  });

  it('registerAgent is defensive against caller-supplied id (always server-assigns)', async () => {
    const [args, key] = registerArgs();
    // Force an id collision attempt
    const evilArgs = { ...args, id: 'attacker-supplied' as any };
    const id = await registry.registerAgent(evilArgs, key);
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    expect(id).not.toBe('attacker-supplied');
    const stored = await registry.getAgent(id);
    expect(stored?.id).toBe(id);
  });

  it('getAgent returns the registered agent', async () => {
    const [args, key] = registerArgs({ name: 'Y' });
    const id = await registry.registerAgent(args, key);
    const got = await registry.getAgent(id);
    expect(got?.name).toBe('Y');
  });

  it('getAgent returns null for unknown ids', async () => {
    expect(await registry.getAgent('00000000-0000-0000-0000-000000000000')).toBeNull();
  });

  it('updateAgent merges fields and refreshes updatedAt', async () => {
    const [args, key] = registerArgs();
    const id = await registry.registerAgent(args, key);
    const before = await registry.getAgent(id);
    await new Promise((r) => setTimeout(r, 5));
    await registry.updateAgent(id, { description: 'New desc', version: '1.1.0' });
    const after = await registry.getAgent(id);
    expect(after?.description).toBe('New desc');
    expect(after?.version).toBe('1.1.0');
    expect(after?.updatedAt).not.toBe(before?.updatedAt);
    expect(hedera.publishMessage).toHaveBeenCalledTimes(2);
  });

  it('updateAgent throws on unknown id', async () => {
    await expect(
      registry.updateAgent('nope', { description: 'x' }),
    ).rejects.toThrow('not found');
  });

  it('deactivateAgent sets status to deprecated and emits event', async () => {
    const [args, key] = registerArgs();
    const id = await registry.registerAgent(args, key);
    await registry.deactivateAgent(id);
    const got = await registry.getAgent(id);
    expect(got?.status).toBe('deprecated');
    const lastCall = hedera.publishMessage.mock.calls.at(-1)!;
    expect(JSON.parse(lastCall[1]).type).toBe('AGENT_DEACTIVATED');
  });

  it('rateAgent updates the rolling average and count', async () => {
    const [args, key] = registerArgs();
    const id = await registry.registerAgent(args, key);
    await registry.rateAgent(id, 5);
    await registry.rateAgent(id, 3);
    await registry.rateAgent(id, 4);
    const got = await registry.getAgent(id);
    expect(got?.ratings.count).toBe(3);
    expect(got?.ratings.average).toBe(4); // (5+3+4)/3 = 4.0
  });

  it('rateAgent throws on unknown id', async () => {
    await expect(registry.rateAgent('nope', 5)).rejects.toThrow('not found');
  });

  it('listAgents filters by capability, minRating, and status', async () => {
    const [a1Args, a1Key] = registerArgs({ name: 'A1', capabilities: ['code-gen'] });
    const a1 = await registry.registerAgent(a1Args, a1Key);
    const [a2Args, a2Key] = registerArgs({ name: 'A2', capabilities: ['image-gen'] });
    const a2 = await registry.registerAgent(a2Args, a2Key);
    await registry.rateAgent(a1, 5);
    await registry.rateAgent(a1, 5);
    await registry.rateAgent(a2, 3);

    const codeGen = await registry.listAgents({ capability: 'code-gen' });
    expect(codeGen.map((a) => a.name)).toEqual(['A1']);

    const topRated = await registry.listAgents({ minRating: 4 });
    expect(topRated.map((a) => a.name)).toEqual(['A1']);

    const onlyActive = await registry.listAgents({ status: 'active' });
    expect(onlyActive).toHaveLength(2);
  });

  it('listAgents sorts by rating descending', async () => {
    const [a1Args, a1Key] = registerArgs({ name: 'Low' });
    const a1 = await registry.registerAgent(a1Args, a1Key);
    const [a2Args, a2Key] = registerArgs({ name: 'High' });
    const a2 = await registry.registerAgent(a2Args, a2Key);
    await registry.rateAgent(a1, 2);
    await registry.rateAgent(a2, 5);
    const all = await registry.listAgents();
    expect(all[0].name).toBe('High');
    expect(all[1].name).toBe('Low');
  });

  it('upgradeAgent increments version and publishes an UPGRADE event', async () => {
    const [args, key] = registerArgs({ version: '1.0.0' });
    const id = await registry.registerAgent(args, key);
    await registry.upgradeAgent(id, '1.1.0', 'bafyupgradecid');
    const got = await registry.getAgent(id);
    expect(got?.version).toBe('1.1.0');
    expect(got?.ipfsCid).toBe('bafyupgradecid');
    const lastCall = hedera.publishMessage.mock.calls.at(-1)!;
    const evt = JSON.parse(lastCall[1]);
    expect(evt.type).toBe('AGENT_UPGRADED');
    expect(evt.fromVersion).toBe('1.0.0');
    expect(evt.toVersion).toBe('1.1.0');
    expect(evt.ipfsCid).toBe('bafyupgradecid');
  });

  it('upgradeAgent rejects empty or downgraded version', async () => {
    const [args, key] = registerArgs({ version: '2.0.0' });
    const id = await registry.registerAgent(args, key);
    await expect(registry.upgradeAgent(id, '1.0.0', 'c')).rejects.toThrow(/higher than current/);
    await expect(registry.upgradeAgent(id, '', 'c')).rejects.toThrow(/required/);
  });

  it('upgradeAgent throws on unknown id', async () => {
    await expect(registry.upgradeAgent('nope', '1.0.0', 'c')).rejects.toThrow('not found');
  });

  it('propagates publish failures to the caller (caller chooses how to retry)', async () => {
    // AgentRegistry does not retry — the retry/cb logic lives in HederaClient
    // (covered in tests/hedera-client.test.ts). Here we verify registry
    // doesn't swallow the error.
    hedera.failNextPublishNTimes(1, 'INSUFFICIENT_ACCOUNT_BALANCE');
    const [args, key] = registerArgs();
    await expect(registry.registerAgent(args, key)).rejects.toThrow(/INSUFFICIENT_ACCOUNT_BALANCE/);
  });
});
