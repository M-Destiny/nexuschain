/**
 * Shared test fixtures: a mock HederaClient that records every publishMessage
 * call and lets tests inject failures / transient errors. Keeps unit tests
 * fast and offline (no real network, no @hashgraph/sdk dependency).
 */
import { vi } from 'vitest';

export interface MockHedera {
  publishMessage: ReturnType<typeof vi.fn>;
  createTopic: ReturnType<typeof vi.fn>;
  getAccountBalance: ReturnType<typeof vi.fn>;
  getOperatorAccountId: ReturnType<typeof vi.fn>;
  getClient: ReturnType<typeof vi.fn>;
  /** Inject a transient error on the next N publishMessage calls. */
  failNextPublishNTimes: (n: number, pattern?: string) => void;
  messages: Array<{ topicId: string; message: string }>;
}

export function makeMockHedera(opts: { operatorId?: string } = {}): MockHedera {
  const operatorId = opts.operatorId ?? '0.0.1001';
  const messages: Array<{ topicId: string; message: string }> = [];
  let failuresRemaining = 0;
  let failurePattern = 'BUSY';

  const failNextPublishNTimes = (n: number, pattern = 'BUSY') => {
    failuresRemaining = n;
    failurePattern = pattern;
  };

  const publishMessage = vi.fn((topicId: string, message: string) => {
    if (failuresRemaining > 0) {
      failuresRemaining -= 1;
      const err = new Error(`${failurePattern} throttled`);
      (err as any).name = failurePattern;
      return Promise.reject(err);
    }
    messages.push({ topicId, message });
    return Promise.resolve(String(messages.length));
  });

  return {
    publishMessage,
    createTopic: vi.fn(async (name: string) => `0.0.${name.length}`),
    getAccountBalance: vi.fn(async () => ({ hbar: 100, tinybars: '10000000000' })),
    getOperatorAccountId: vi.fn(() => operatorId),
    getClient: vi.fn(),
    failNextPublishNTimes,
    messages,
  };
}
