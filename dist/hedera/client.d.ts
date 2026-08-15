import { Client } from '@hashgraph/sdk';
export interface HederaClientOptions {
    accountId: string;
    privateKey: string;
    network: 'mainnet' | 'testnet' | 'previewnet';
    /** Max number of publish retries with exponential backoff. Default 4. */
    maxRetries?: number;
    /** Base backoff delay in ms; doubled each retry. Default 250. */
    backoffBaseMs?: number;
    /** Circuit-breaker failure threshold before fast-fail for 30s. Default 5. */
    circuitFailureThreshold?: number;
}
/**
 * Thin wrapper around the Hedera Consensus/Token Service SDK that adds:
 *   - exponential-backoff retry for transient HCS publish errors,
 *   - a per-instance circuit breaker that fast-fails for 30 s after N consecutive
 *     failures to prevent hammering a degraded node,
 *   - structured error logging.
 *
 * Retries are intentionally limited to transient errors (BUSY / TIMEOUT /
 * connection-level); authentication / INSUFFICIENT_ACCOUNT_BALANCE / NOT_FOUND
 * errors throw immediately to avoid masking user mistakes.
 */
export declare class HederaClient {
    private client;
    private accountId;
    private privateKey;
    private maxRetries;
    private backoffBaseMs;
    private circuitFailureThreshold;
    private circuit;
    constructor(config: HederaClientOptions);
    createTopic(name: string): Promise<string>;
    /**
     * Publish a JSON-or-string message to an HCS topic with automatic exponential
     * backoff on transient errors. Returns the topic sequence number.
     */
    publishMessage(topicId: string, message: string): Promise<string>;
    getAccountBalance(): Promise<{
        hbar: number;
        tinybars: string;
    }>;
    getOperatorAccountId(): string;
    getClient(): Client;
    private executeWithBreaker;
    private assertCircuitClosed;
    private recordSuccess;
    private recordFailure;
    private isTransient;
    private sleep;
}
//# sourceMappingURL=client.d.ts.map