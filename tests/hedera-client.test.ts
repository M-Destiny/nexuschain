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
    // Failure 1 — circuit still below threshold
    await expect(c.publishMessage('0.0.7', 'a')).rejects.toThrow(/UNAVAILABLE/);
    // Failure 2 — circuit opens
    await expect(c.publishMessage('0.0.7', 'b')).rejects.toThrow(/UNAVAILABLE/);
    // Next call should fast-fail without invoking execute further
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
});
