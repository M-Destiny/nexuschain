// Inline mock factory — vi.mock is hoisted, so the SDK must not reference
// any top-level const. Dynamic calls inside the factory configure behaviour
// that the tests then drive via the exported `getExecuteMock` / `setExecute`.
let executeMock: (() => Promise<any>) | null = null;
let createTopicReceipt: () => { topicId: { toString: () => string } } = () => ({
  topicId: { toString: () => '0.0.9999' },
});
let balanceReceipt: () => { hbars: { toBigNumber: () => { toNumber: () => number }; toString: () => string } } = () => ({
  hbars: {
    toBigNumber: () => ({ toNumber: () => 100 }),
    toString: () => '10000000000',
  },
});

function makeChainable() {
  const obj: any = {};
  obj.setTopicId = () => obj;
  obj.setMessage = () => obj;
  obj.setTopicMemo = () => obj;
  obj.setAccountId = () => obj;
  return obj;
}

vi.mock('@hashgraph/sdk', () => {
  const defaultReceipt = () => ({
    getReceipt: async () => ({
      topicSequenceNumber: { toString: () => '1' },
    }),
  });
  return {
    Client: {
      forNetwork: () => ({
        setOperator: () => undefined,
        close: () => undefined,
      }),
    },
    AccountId: function (shard: number, realm: number, num: number) {
      return { toString: () => `${shard}.${realm}.${num}` };
    },
    PrivateKey: { fromString: () => ({}) },
    TopicId: { fromString: (s: string) => ({ toString: () => s }) },
    TopicMessageSubmitTransaction: function () {
      const obj = makeChainable();
      obj.execute = async () => (executeMock ? executeMock() : defaultReceipt());
      return obj;
    },
    TopicCreateTransaction: function () {
      const obj = makeChainable();
      obj.execute = async () => ({
        getReceipt: async () => createTopicReceipt(),
      });
      return obj;
    },
    AccountBalanceQuery: function () {
      const obj = makeChainable();
      obj.execute = async () => balanceReceipt();
      return obj;
    },
  };
});

// Helper for tests: set what `executeMock` should return / throw.
function setExecuteSequence(...behaviours: Array<'success' | { throw: Error }>) {
  let i = 0;
  executeMock = async () => {
    const b = behaviours[i++] ?? behaviours[behaviours.length - 1];
    if (b === 'success') {
      return {
        getReceipt: async () => ({
          topicSequenceNumber: { toString: () => '42' },
        }),
      };
    }
    throw b.throw;
  };
}

function alwaysExecute(behaviour: 'success' | { throw: Error }) {
  executeMock = async () => {
    if (behaviour === 'success') {
      return {
        getReceipt: async () => ({
          topicSequenceNumber: { toString: () => '42' },
        }),
      };
    }
    throw behaviour.throw;
  };
}

function makeTransient(msg: string) {
  const err = new Error(msg);
  (err as any).name = msg;
  return err;
}

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { HederaClient } from '../src/hedera/client.js';

beforeEach(() => {
  executeMock = null;
  createTopicReceipt = () => ({ topicId: { toString: () => '0.0.9999' } });
  balanceReceipt = () => ({
    hbars: {
      toBigNumber: () => ({ toNumber: () => 100 }),
      toString: () => '10000000000',
    },
  });
});

describe('HederaClient', () => {
  it('publishMessage retries on transient errors and succeeds', async () => {
    setExecuteSequence(
      { throw: makeTransient('BUSY') },
      { throw: makeTransient('TIMEOUT') },
      'success',
    );
    const c = new HederaClient({
      accountId: '0.0.1001',
      privateKey: 'fake-key',
      network: 'testnet',
      maxRetries: 4,
      backoffBaseMs: 1,
    });
    const seq = await c.publishMessage('0.0.7', 'hello');
    expect(seq).toBe('42');
  });

  it('publishMessage throws immediately on non-transient errors', async () => {
    const nonTransient = new Error('INSUFFICIENT_ACCOUNT_BALANCE');
    alwaysExecute({ throw: nonTransient });
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
    const fail = makeTransient('UNAVAILABLE');
    alwaysExecute({ throw: fail });
    const c = new HederaClient({
      accountId: '0.0.1001',
      privateKey: 'fake-key',
      network: 'testnet',
      maxRetries: 1,
      backoffBaseMs: 1,
      circuitFailureThreshold: 2,
    });
    // First call: retries once (maxRetries=1), fails twice → circuit opens at threshold=2
    await expect(c.publishMessage('0.0.7', 'a')).rejects.toThrow(/UNAVAILABLE/);
    // Second call: circuit is now OPEN → fast-fails with circuit breaker error
    await expect(c.publishMessage('0.0.7', 'b')).rejects.toThrow(/circuit breaker is OPEN/);
    // Third call: still fast-fails
    await expect(c.publishMessage('0.0.7', 'c')).rejects.toThrow(/circuit breaker is OPEN/);
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

  it('proxies faucet requests to the Hedera portal', async () => {
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
      const [url, init] = fakeFetch.mock.calls[0];
      expect(url).toContain('portal.hedera.com');
      expect(init).toEqual({ method: 'POST' });
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

  it('fundFromTestnetFaucet surfaces faucet failure status', async () => {
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async () => ({
      ok: false,
      status: 429,
      statusText: 'Too Many Requests',
      text: async () => 'rate-limited',
    })) as any;
    try {
      const c = new HederaClient({
        accountId: '0.0.12345',
        privateKey: 'k',
        network: 'testnet',
      });
      await expect(c.fundFromTestnetFaucet()).rejects.toThrow(/429/);
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  // --- IPFS Pinning Tests ---
  describe('pinToIPFS', () => {
    it('pins JSON data to IPFS via Web3.Storage and returns CID', async () => {
      const realFetch = globalThis.fetch;
      const fakeFetch = vi.fn(async () => ({
        ok: true,
        json: async () => ({ cid: 'bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi', size: 1234 }),
      })) as any;
      globalThis.fetch = fakeFetch;
      try {
        const c = new HederaClient({
          accountId: '0.0.12345',
          privateKey: 'k',
          network: 'testnet',
          web3StorageToken: 'test-token-123',
        });
        const result = await c.pinToIPFS({ hello: 'world', number: 42 });
        expect(result.cid).toBe('bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi');
        expect(result.size).toBe(1234);
        expect(result.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
        expect(fakeFetch).toHaveBeenCalledTimes(1);
        const [url, init] = fakeFetch.mock.calls[0];
        expect(url).toBe('https://api.web3.storage/upload');
        expect(init.method).toBe('POST');
        expect(init.headers.Authorization).toBe('Bearer test-token-123');
        expect(init.headers['Content-Type']).toBe('application/json');
        const body = JSON.parse(init.body);
        expect(body).toEqual({ hello: 'world', number: 42 });
      } finally {
        globalThis.fetch = realFetch;
      }
    });

    it('throws when web3StorageToken is not configured', async () => {
      const c = new HederaClient({
        accountId: '0.0.12345',
        privateKey: 'k',
        network: 'testnet',
        // no web3StorageToken
      });
      await expect(c.pinToIPFS({ test: 'data' })).rejects.toThrow(/Web3.Storage token not configured/);
    });

    it('throws on Web3.Storage API error with status and body', async () => {
      const realFetch = globalThis.fetch;
      globalThis.fetch = (async () => ({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
        text: async () => 'Invalid API token',
      })) as any;
      try {
        const c = new HederaClient({
          accountId: '0.0.12345',
          privateKey: 'k',
          network: 'testnet',
          web3StorageToken: 'bad-token',
        });
        await expect(c.pinToIPFS({ test: 'data' })).rejects.toThrow(/401/);
      } finally {
        globalThis.fetch = realFetch;
      }
    });

    it('handles large JSON payloads correctly', async () => {
      const realFetch = globalThis.fetch;
      const largeData = { items: Array.from({ length: 1000 }, (_, i) => ({ id: i, data: 'x'.repeat(100) })) };
      const fakeFetch = vi.fn(async () => ({
        ok: true,
        json: async () => ({ cid: 'bafylargecid123', size: 102400 }),
      })) as any;
      globalThis.fetch = fakeFetch;
      try {
        const c = new HederaClient({
          accountId: '0.0.12345',
          privateKey: 'k',
          network: 'testnet',
          web3StorageToken: 'test-token',
        });
        const result = await c.pinToIPFS(largeData);
        expect(result.cid).toBe('bafylargecid123');
        expect(fakeFetch).toHaveBeenCalledTimes(1);
      } finally {
        globalThis.fetch = realFetch;
      }
    });
  });
});
