import { describe, it, expect, beforeEach, vi } from 'vitest';
import { HederaClient } from '../src/hedera/client.js';

// Mock the @hashgraph/sdk module so we never hit the real network.
// We exercise the retry / circuit-breaker logic by controlling the
// publishMessage call's behaviour.
const SDK = {
  Client: {
    forNetwork: vi.fn(() => ({
      setOperator: vi.fn(),
      close: vi.fn(),
    })),
  },
  AccountId: vi.fn((shard: number, realm: number, num: number) => ({
    toString: () => `${shard}.${realm}.${num}`,
  })),
  PrivateKey: {
    fromString: vi.fn(() => ({})),
  },
  TopicId: {
    fromString: vi.fn((s: string) => ({ toString: () => s })),
  },
  TopicMessageSubmitTransaction: vi.fn(() => {
    const tx: any = {
      setTopicId: vi.fn(() => tx),
      setMessage: vi.fn(() => tx),
      execute: vi.fn(async () => ({
        getReceipt: vi.fn(async () => ({
          topicSequenceNumber: { toString: () => '1' },
        })),
      })),
    };
    return tx;
  }),
  TopicCreateTransaction: vi.fn(() => ({
    setTopicMemo: vi.fn(function (this: any) { return this; }),
    execute: vi.fn(async () => ({
      getReceipt: vi.fn(async () => ({ topicId: { toString: () => '0.0.9999' } })),
    })),
  })),
  AccountBalanceQuery: vi.fn(() => ({
    setAccountId: vi.fn(function (this: any) { return this; }),
    execute: vi.fn(async () => ({
      hbars: {
        toBigNumber: () => ({ toNumber: () => 100 }),
        toString: () => '10000000000',
      },
    })),
  })),
};

vi.mock('@hashgraph/sdk', () => SDK);

describe('HederaClient', () => {
  let flakingExecute: ReturnType<typeof vi.fn>;
  let alwaysFailExecute: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    flakingExecute = vi.fn()
      .mockRejectedValueOnce(makeTransient('BUSY'))
      .mockRejectedValueOnce(makeTransient('TIMEOUT'))
      .mockResolvedValueOnce({
        getReceipt: vi.fn(async () => ({
          topicSequenceNumber: { toString: () => '42' },
        })),
      });
    alwaysFailExecute = vi.fn().mockRejectedValue(makeTransient('UNAVAILABLE'));
  });

  it('publishMessage retries on transient errors and succeeds', async () => {
    SDK.TopicMessageSubmitTransaction.mockImplementation(() => ({
      setTopicId: vi.fn(function (this: any) { return this; }),
      setMessage: vi.fn(function (this: any) { return this; }),
      execute: flakingExecute,
    }));
    const c = new HederaClient({
      accountId: '0.0.1001',
      privateKey: 'fake-key',
      network: 'testnet',
      maxRetries: 4,
      backoffBaseMs: 1,
    });
    const seq = await c.publishMessage('0.0.7', 'hello');
    expect(seq).toBe('42');
    expect(flakingExecute).toHaveBeenCalledTimes(3);
  });

  it('publishMessage throws immediately on non-transient errors', async () => {
    const nonTransient = new Error('INSUFFICIENT_ACCOUNT_BALANCE');
    SDK.TopicMessageSubmitTransaction.mockImplementation(() => ({
      setTopicId: vi.fn(function (this: any) { return this; }),
      setMessage: vi.fn(function (this: any) { return this; }),
      execute: vi.fn().mockRejectedValue(nonTransient),
    }));
    const c = new HederaClient({
      accountId: '0.0.1001',
      privateKey: 'fake-key',
      network: 'testnet',
      maxRetries: 4,
      backoffBaseMs: 1,
    });
    await expect(c.publishMessage('0.0.7', 'hi')).rejects.toBe(nonTransient);
  });

  it('publishMessage opens the circuit breaker after N consecutive failures', async () => {
    SDK.TopicMessageSubmitTransaction.mockImplementation(() => ({
      setTopicId: vi.fn(function (this: any) { return this; }),
      setMessage: vi.fn(function (this: any) { return this; }),
      execute: alwaysFailExecute,
    }));
    const c = new HederaClient({
      accountId: '0.0.1001',
      privateKey: 'fake-key',
      network: 'testnet',
      maxRetries: 1,
      backoffBaseMs: 1,
      circuitFailureThreshold: 2,
    });
    // Failure 1 — threshold=2, so circuit still closed but logs
    await expect(c.publishMessage('0.0.7', 'a')).rejects.toThrow();
    // Failure 2 — circuit opens
    await expect(c.publishMessage('0.0.7', 'b')).rejects.toThrow();
    // Next call should fast-fail without invoking execute
    const beforeCalls = alwaysFailExecute.mock.calls.length;
    await expect(c.publishMessage('0.0.7', 'c')).rejects.toThrow(/circuit breaker is OPEN/);
    expect(alwaysFailExecute.mock.calls.length).toBe(beforeCalls);
  });

  it('getOperatorAccountId returns the configured accountId', () => {
    const c = new HederaClient({
      accountId: '0.0.42',
      privateKey: 'k',
      network: 'testnet',
    });
    expect(c.getOperatorAccountId()).toBe('0.0.42');
  });

  it('getAccountBalance returns hbar and tinybars', async () => {
    const c = new HederaClient({
      accountId: '0.0.42',
      privateKey: 'k',
      network: 'testnet',
    });
    const bal = await c.getAccountBalance();
    expect(bal.hbar).toBe(100);
    expect(bal.tinybars).toBe('10000000000');
  });

  it('createTopic returns a topic id string', async () => {
    const c = new HederaClient({
      accountId: '0.0.42',
      privateKey: 'k',
      network: 'testnet',
    });
    const id = await c.createTopic('nexus-test');
    expect(id).toBe('0.0.9999');
  });

  it('proxies faucet requests to the Hedera testnet faucet', async () => {
    const realFetch = globalThis.fetch;
    const fakeFetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({ status: 'OK', accountId: '0.0.12345' }),
    })) as any;
    globalThis.fetch = fakeFetch;
    try {
      const c = new HederaClient({
        accountId: '0.0.12345',
        privateKey: 'k',
        network: 'testnet',
      });
      const res = await c.fundFromTestnetFaucet();
      expect(res.status).toBe('OK');
      expect(fakeFetch).toHaveBeenCalledTimes(1);
      const [url] = fakeFetch.mock.calls[0];
      expect(url).toContain('testnet.mirrornode.hedera.com');
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  it('fundFromTestnetFaucet throws on non-testnet networks', async () => {
    const c = new HederaClient({
      accountId: '0.0.12345',
      privateKey: 'k',
      network: 'mainnet',
    });
    await expect(c.fundFromTestnetFaucet()).rejects.toThrow(/testnet/);
  });
});

function makeTransient(msg: string) {
  const err = new Error(msg);
  (err as any).name = msg;
  return err;
}
