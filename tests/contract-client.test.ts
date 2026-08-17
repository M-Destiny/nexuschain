import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ContractClient, resetContractMetricsRegistry } from '../src/hedera/contract-client.js';
import { HederaClient } from '../src/hedera/client.js';

// Mock ethers module
const mockContract = {
  registerAgent: vi.fn(),
  updateAgent: vi.fn(),
  updateSubscriptionTiers: vi.fn(),
  getAgent: vi.fn(),
  getSubscriptionTiers: vi.fn(),
  listAgent: vi.fn(),
  purchaseAgent: vi.fn(),
  rateAgent: vi.fn(),
  getAverageRating: vi.fn(),
  upgradeAgent: vi.fn(),
  createProposal: vi.fn(),
  vote: vi.fn(),
  executeProposal: vi.fn(),
  proposals: vi.fn(),
  treasury: vi.fn(),
  setTreasury: vi.fn(),
  withdrawTreasury: vi.fn(),
  agentRevenue: vi.fn(),
  filters: {
    AgentRegistered: vi.fn(),
    AgentPurchased: vi.fn(),
    AgentRated: vi.fn(),
    AgentDeactivated: vi.fn(),
    AgentUpgraded: vi.fn(),
    ProposalCreated: vi.fn(),
    VoteCast: vi.fn(),
    ProposalExecuted: vi.fn(),
  },
  queryFilter: vi.fn(),
  on: vi.fn(),
  off: vi.fn(),
  removeAllListeners: vi.fn(),
};

const mockInterface = {
  parseLog: vi.fn(),
};

vi.mock('ethers', () => ({
  ethers: {
    Contract: vi.fn(() => mockContract),
    JsonRpcProvider: vi.fn(),
    Wallet: vi.fn(),
    Interface: vi.fn(() => mockInterface),
  },
  Contract: vi.fn(() => mockContract),
  JsonRpcProvider: vi.fn(),
  Wallet: vi.fn(),
  Interface: vi.fn(() => mockInterface),
}));

function makeMockHederaClient() {
  return {
    getNetwork: vi.fn(() => 'testnet'),
    getOperatorAccountId: vi.fn(() => '0.0.1001'),
    privateKey: 'fake-key',
    publishMessage: vi.fn(),
  } as unknown as HederaClient;
}

describe('ContractClient', () => {
  let hederaClient: HederaClient;
  let contractClient: ContractClient;

  beforeEach(async () => {
    vi.clearAllMocks();
    hederaClient = makeMockHederaClient();
    resetContractMetricsRegistry();

    contractClient = new ContractClient({
      contractAddress: '0.0.123456',
      hederaClient,
    });
  });

  describe('registerAgent', () => {
    it('registers an agent on-chain and returns tx hash', async () => {
      const mockTx = { wait: vi.fn().mockResolvedValue({ hash: '0xabc', blockNumber: 100 }) };
      mockContract.registerAgent.mockResolvedValue(mockTx);

      const result = await contractClient.registerAgent(
        'agent-1',
        'Test Agent',
        'A test agent',
        1000000n,
        'bafy123',
        ['code-gen'],
        [{ name: 'basic', pricePerMonth: 5000000n, callsPerMonth: 1000n, features: ['chat'], isActive: true }],
        '1.0.0',
      );

      expect(result.txHash).toBe('0xabc');
      expect(result.blockNumber).toBe(100);
      expect(mockContract.registerAgent).toHaveBeenCalled();
    });

    it('increments agent_registered_total metric', async () => {
      const mockTx = { wait: vi.fn().mockResolvedValue({ hash: '0xabc', blockNumber: 100 }) };
      mockContract.registerAgent.mockResolvedValue(mockTx);

      await contractClient.registerAgent(
        'agent-1',
        'Test Agent',
        'A test agent',
        1000000n,
        'bafy123',
        ['code-gen'],
        [],
        '1.0.0',
      );

      const registry = contractClient.getMetricsRegistry();
      const counter = registry.getSingleMetric('contractclient_agent_registered_total') as any;
      const value = counter?.hashMap?.['']?.value ?? 0;
      expect(value).toBe(1);
    });
  });

  describe('purchaseAgent', () => {
    it('purchases agent access with HBAR payment', async () => {
      const mockTx = {
        wait: vi.fn().mockResolvedValue({
          hash: '0xdef',
          blockNumber: 101,
          gasUsed: 50000n,
          logs: [{
            topics: ['0xagentpurchased'],
            data: '0x',
          }],
        }),
      };
      mockContract.purchaseAgent.mockResolvedValue(mockTx);
      mockInterface.parseLog.mockReturnValue({
        name: 'AgentPurchased',
        args: { price: 1000000n, seller: '0x000000000000000000000000000000000001e240' },
      });

      const result = await contractClient.purchaseAgent('agent-1', 1500000n);

      expect(result.txHash).toBe('0xdef');
      expect(result.price).toBe(1000000n);
      // The seller address is returned as-is from the event (EVM format)
      expect(result.seller).toBe('0x000000000000000000000000000000000001e240');
      expect(mockContract.purchaseAgent).toHaveBeenCalledWith('agent-1', { value: 1500000n });
    });

    it('increments agent_purchased_total metric', async () => {
      const mockTx = {
        wait: vi.fn().mockResolvedValue({
          hash: '0xdef',
          blockNumber: 101,
          gasUsed: 50000n,
          logs: [],
        }),
      };
      mockContract.purchaseAgent.mockResolvedValue(mockTx);
      mockInterface.parseLog.mockReturnValue(null);

      await contractClient.purchaseAgent('agent-1', 1000000n);

      const registry = contractClient.getMetricsRegistry();
      const counter = registry.getSingleMetric('contractclient_agent_purchased_total') as any;
      const value = counter?.hashMap?.['']?.value ?? 0;
      expect(value).toBe(1);
    });
  });

  describe('rateAgent', () => {
    it('rates an agent 1-5 stars', async () => {
      const mockTx = { wait: vi.fn().mockResolvedValue({ hash: '0xghi', blockNumber: 102 }) };
      mockContract.rateAgent.mockResolvedValue(mockTx);

      const result = await contractClient.rateAgent('agent-1', 5);

      expect(result.txHash).toBe('0xghi');
      expect(mockContract.rateAgent).toHaveBeenCalledWith('agent-1', 5);
    });

    it('throws on invalid rating', async () => {
      await expect(contractClient.rateAgent('agent-1', 0)).rejects.toThrow('Rating must be 1-5');
      await expect(contractClient.rateAgent('agent-1', 6)).rejects.toThrow('Rating must be 1-5');
    });
  });

  describe('upgradeAgent', () => {
    it('upgrades agent to new version', async () => {
      const mockTx = { wait: vi.fn().mockResolvedValue({ hash: '0xjkl', blockNumber: 103 }) };
      mockContract.upgradeAgent.mockResolvedValue(mockTx);

      const result = await contractClient.upgradeAgent('agent-1', '1.1.0', 'bafy456');

      expect(result.txHash).toBe('0xjkl');
      expect(mockContract.upgradeAgent).toHaveBeenCalledWith('agent-1', '1.1.0', 'bafy456');
    });

    it('increments agent_upgraded_total metric', async () => {
      const mockTx = { wait: vi.fn().mockResolvedValue({ hash: '0xjkl', blockNumber: 103 }) };
      mockContract.upgradeAgent.mockResolvedValue(mockTx);

      await contractClient.upgradeAgent('agent-1', '1.1.0', 'bafy456');

      const registry = contractClient.getMetricsRegistry();
      const counter = registry.getSingleMetric('contractclient_agent_upgraded_total') as any;
      const value = counter?.hashMap?.['']?.value ?? 0;
      expect(value).toBe(1);
    });
  });

  describe('createProposal', () => {
    it('creates a governance proposal', async () => {
      const mockTx = { wait: vi.fn().mockResolvedValue({ hash: '0xmno', blockNumber: 104 }) };
      mockContract.createProposal.mockResolvedValue(mockTx);

      const result = await contractClient.createProposal('prop-1', 'Test Proposal', 'Description', 7);

      expect(result.txHash).toBe('0xmno');
      expect(mockContract.createProposal).toHaveBeenCalledWith('prop-1', 'Test Proposal', 'Description', 7);
    });

    it('increments proposal_created_total metric', async () => {
      const mockTx = { wait: vi.fn().mockResolvedValue({ hash: '0xmno', blockNumber: 104 }) };
      mockContract.createProposal.mockResolvedValue(mockTx);

      await contractClient.createProposal('prop-1', 'Test Proposal', 'Description', 7);

      const registry = contractClient.getMetricsRegistry();
      const counter = registry.getSingleMetric('contractclient_proposal_created_total') as any;
      const value = counter?.hashMap?.['']?.value ?? 0;
      expect(value).toBe(1);
    });
  });

  describe('vote', () => {
    it('votes on a proposal with HBAR weight', async () => {
      const mockTx = { wait: vi.fn().mockResolvedValue({ hash: '0xpqr', blockNumber: 105 }) };
      mockContract.vote.mockResolvedValue(mockTx);

      const result = await contractClient.vote('prop-1', true, 1000000n);

      expect(result.txHash).toBe('0xpqr');
      expect(mockContract.vote).toHaveBeenCalledWith('prop-1', true, 1000000n);
    });
  });

  describe('executeProposal', () => {
    it('executes a proposal after voting ends', async () => {
      const mockTx = {
        wait: vi.fn().mockResolvedValue({
          hash: '0xstu',
          blockNumber: 106,
          logs: [{
            topics: ['0xproposalexecuted'],
            data: '0x',
          }],
        }),
      };
      mockContract.executeProposal.mockResolvedValue(mockTx);
      mockInterface.parseLog.mockReturnValue({
        name: 'ProposalExecuted',
        args: { passed: true },
      });

      const result = await contractClient.executeProposal('prop-1');

      expect(result.txHash).toBe('0xstu');
      expect(result.passed).toBe(true);
    });
  });

  describe('getAgent', () => {
    it('returns agent metadata from contract', async () => {
      mockContract.getAgent.mockResolvedValue([
        'agent-1',
        'Test Agent',
        'Description',
        '0x000000000000000000000000000000000001e240',
        1000000n,
        0n,
        0n,
        true,
        'bafy123',
        ['code-gen'],
        [],
        '1.0.0',
      ]);

      const agent = await contractClient.getAgent('agent-1');

      expect(agent).not.toBeNull();
      expect(agent?.id).toBe('agent-1');
      expect(agent?.name).toBe('Test Agent');
      expect(agent?.owner).toBe('0.0.123456');
    });

    it('returns null for non-existent agent', async () => {
      mockContract.getAgent.mockResolvedValue(['', '', '', '', 0n, 0n, 0n, false, '', [], [], '']);

      const agent = await contractClient.getAgent('unknown');
      expect(agent).toBeNull();
    });
  });

  describe('getAverageRating', () => {
    it('returns average rating', async () => {
      mockContract.getAverageRating.mockResolvedValue(4n);

      const rating = await contractClient.getAverageRating('agent-1');
      expect(rating).toBe(4);
    });
  });

  describe('getProposal', () => {
    it('returns proposal state from contract', async () => {
      mockContract.proposals.mockResolvedValue([
        'prop-1',
        'Test',
        'Desc',
        1000000n,
        500000n,
        1234567890n,
        false,
        true,
      ]);

      const proposal = await contractClient.getProposal('prop-1');

      expect(proposal).not.toBeNull();
      expect(proposal?.id).toBe('prop-1');
      expect(proposal?.title).toBe('Test');
    });

    it('returns null for non-existent proposal', async () => {
      mockContract.proposals.mockResolvedValue(['', '', '', 0n, 0n, 0n, false, false]);

      const proposal = await contractClient.getProposal('unknown');
      expect(proposal).toBeNull();
    });
  });

  describe('getTreasury', () => {
    it('returns treasury address', async () => {
      mockContract.treasury.mockResolvedValue('0x000000000000000000000000000000000001e240');

      const treasury = await contractClient.getTreasury();
      expect(treasury).toBe('0.0.123456');
    });
  });

  describe('getAgentRevenue', () => {
    it('returns agent revenue', async () => {
      mockContract.agentRevenue.mockResolvedValue(5000000n);

      const revenue = await contractClient.getAgentRevenue('agent-1');
      expect(revenue).toBe(5000000n);
    });
  });

  describe('event filters', () => {
    it('creates filter for AgentRegistered events', () => {
      const filter = contractClient.filterAgentRegistered(100, 200);
      expect(mockContract.filters.AgentRegistered).toHaveBeenCalledWith(null, null, 100, 200);
    });

    it('creates filter for AgentPurchased events', () => {
      const filter = contractClient.filterAgentPurchased('agent-1', 100, 200);
      expect(mockContract.filters.AgentPurchased).toHaveBeenCalledWith('agent-1', null, null, 100, 200);
    });

    it('creates filter for VoteCast events', () => {
      const filter = contractClient.filterVoteCast('prop-1', 100, 200);
      expect(mockContract.filters.VoteCast).toHaveBeenCalledWith('prop-1', null, null, 100, 200);
    });
  });

  describe('queryEvents', () => {
    it('queries historical events with a filter', async () => {
      const mockFilter = {};
      const mockEvents = [{ name: 'AgentRegistered', args: { id: 'agent-1' } }];
      mockContract.queryFilter.mockResolvedValue(mockEvents);

      const events = await contractClient.queryEvents(mockFilter as any);
      expect(events).toEqual(mockEvents);
      expect(mockContract.queryFilter).toHaveBeenCalledWith(mockFilter);
    });
  });

  describe('listeners', () => {
    it('adds and removes event listeners', () => {
      const listener = vi.fn();
      const unsubscribe = contractClient.on('AgentRegistered', listener);
      expect(mockContract.on).toHaveBeenCalledWith('AgentRegistered', listener);
      expect(typeof unsubscribe).toBe('function');

      unsubscribe();
      expect(mockContract.off).toHaveBeenCalledWith('AgentRegistered', listener);
    });

    it('removes all listeners', () => {
      contractClient.removeAllListeners();
      expect(mockContract.removeAllListeners).toHaveBeenCalled();
    });
  });

  describe('metrics', () => {
    it('exposes metrics registry', () => {
      const registry = contractClient.getMetricsRegistry();
      expect(registry).toBeDefined();
    });

    it('resets metrics registry', () => {
      resetContractMetricsRegistry();
      const registry = contractClient.getMetricsRegistry();
      expect(registry).toBeDefined(); // New registry created
    });
  });
});