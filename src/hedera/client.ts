import {
  Client,
  AccountId,
  PrivateKey,
  TopicId,
  TopicMessageSubmitTransaction,
  TopicCreateTransaction,
  AccountBalanceQuery,
} from '@hashgraph/sdk';

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
  /** Web3.Storage API token for IPFS pinning (optional). */
  web3StorageToken?: string;
}

interface CircuitState {
  failures: number;
  openUntil: number; // epoch ms; circuit is OPEN until this time
}

/** Result of an IPFS pinning operation. */
export interface PinResult {
  cid: string;
  size: number;
  timestamp: string;
}

const NETWORK_MAP = {
  mainnet: { '35.237.200.180:50211': new AccountId(0, 0, 1) },
  testnet: { '0.0.3': new AccountId(0, 0, 3) },
  previewnet: { '0.0.4': new AccountId(0, 0, 4) },
} as const;

// Errors matching these substrings are considered transient (worth retrying).
const TRANSIENT_PATTERNS = [
  'BUSY',
  'PLATFORM_TRANSACTION_NOT_CREATED',
  'TIMEOUT',
  'UNAVAILABLE',
  'RESOURCE_EXHAUSTED',
  'INTERNAL',
  'CONNECTION_LOST',
  'ECONNRESET',
  'ETIMEDOUT',
];

// Pinata API endpoint for IPFS pinning
const PINATA_API_URL = 'https://api.pinata.cloud/pinning/pinJSONToIPFS';

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
export class HederaClient {
  private client: Client;
  private accountId: string;
  private privateKey: string;
  private network: 'mainnet' | 'testnet' | 'previewnet';
  private maxRetries: number;
  private backoffBaseMs: number;
  private circuitFailureThreshold: number;
  private circuit: CircuitState = { failures: 0, openUntil: 0 };
  private web3StorageToken?: string;

  constructor(config: HederaClientOptions) {
    this.accountId = config.accountId;
    this.privateKey = config.privateKey;
    this.network = config.network;
    this.maxRetries = config.maxRetries ?? 4;
    this.backoffBaseMs = config.backoffBaseMs ?? 250;
    this.circuitFailureThreshold = config.circuitFailureThreshold ?? 5;
    this.web3StorageToken = config.web3StorageToken;

    this.client = Client.forNetwork(NETWORK_MAP[config.network]);
    this.client.setOperator(
      new AccountId(this.accountId),
      PrivateKey.fromString(this.privateKey),
    );
  }

  async createTopic(name: string): Promise<string> {
    this.assertCircuitClosed();
    return this.executeWithBreaker(async () => {
      const tx = await new TopicCreateTransaction().setTopicMemo(name).execute(this.client);
      const receipt = await tx.getReceipt(this.client);
      if (!receipt.topicId) throw new Error('Failed to create topic');
      return receipt.topicId.toString();
    }, 'createTopic');
  }

  /**
   * Publish a JSON-or-string message to an HCS topic with automatic exponential
   * backoff on transient errors. Returns the topic sequence number.
   */
  async publishMessage(topicId: string, message: string): Promise<string> {
    this.assertCircuitClosed();

    let lastError: unknown;
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        const seqNum = await this.executeWithBreaker(async () => {
          const tx = await new TopicMessageSubmitTransaction()
            .setTopicId(TopicId.fromString(topicId))
            .setMessage(message)
            .execute(this.client);
          const receipt = await tx.getReceipt(this.client);
          return receipt.topicSequenceNumber?.toString() ?? '';
        }, 'publishMessage');
        // success — reset breaker on successful call (already happens inside)
        return seqNum;
      } catch (err) {
        lastError = err;
        const transient = this.isTransient(err);
        if (!transient || attempt === this.maxRetries) {
          throw err;
        }
        const delay = this.backoffBaseMs * Math.pow(2, attempt);
        await this.sleep(delay + Math.floor(Math.random() * 50)); // jitter
      }
    }
    // Should be unreachable, but TS needs the throw.
    throw lastError instanceof Error ? lastError : new Error(String(lastError));
  }

  async getAccountBalance(): Promise<{ hbar: number; tinybars: string }> {
    this.assertCircuitClosed();
    return this.executeWithBreaker(async () => {
      const balance = await new AccountBalanceQuery()
        .setAccountId(this.accountId)
        .execute(this.client);
      return {
        hbar: balance.hbars.toBigNumber().toNumber(),
        tinybars: balance.hbars.toString(),
      };
    }, 'getAccountBalance');
  }

  getOperatorAccountId(): string {
    return this.accountId;
  }

  getClient(): Client {
    return this.client;
  }

  /**
   * Request HBAR from the Hedera testnet faucet for the operator account.
   * Useful for spinning up dev environments without manually pasting
   * account IDs into the web form.
   *
   * Refuses to run on mainnet or previewnet — the testnet faucet only
   * funds testnet accounts, and silently requesting on mainnet would be
   * a fatal operational mistake.
   *
   * @throws if the network is not testnet, or the faucet returns non-OK.
   */
  async fundFromTestnetFaucet(): Promise<{ status: string; accountId: string }> {
    if (this.network !== 'testnet') {
      throw new Error(
        `fundFromTestnetFaucet is only safe on testnet; current network is '${this.network}'.`,
      );
    }
    // The canonical Hedera testnet faucet is reached via the portal API.
    const portalUrl = `https://portal.hedera.com/api/v1/faucet/transfer?accountId=${encodeURIComponent(this.accountId)}`;
    const res = await fetch(portalUrl, { method: 'POST' });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Hedera faucet request failed: ${res.status} ${res.statusText} ${body}`);
    }
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    return {
      status: (data.status as string) ?? 'UNKNOWN',
      accountId: this.accountId,
    };
  }

  /**
   * Pin JSON data to IPFS via Web3.Storage.
   * Requires `web3StorageToken` to be configured in the client options.
   * Returns the CID of the pinned content.
   */
  async pinToIPFS(data: unknown): Promise<PinResult> {
    if (!this.web3StorageToken) {
      throw new Error('Web3.Storage token not configured. Set web3StorageToken in HederaClientOptions.');
    }
    const payload = JSON.stringify(data);
    const res = await fetch('https://api.web3.storage/upload', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.web3StorageToken}`,
        'Content-Type': 'application/json',
      },
      body: payload,
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Web3.Storage upload failed: ${res.status} ${res.statusText} ${body}`);
    }
    const json = await res.json() as { cid: string; size: number };
    return {
      cid: json.cid,
      size: json.size,
      timestamp: new Date().toISOString(),
    };
  }

  // ---------------------------------------------------------------------------
  // Internal: circuit breaker & error classification
  // ---------------------------------------------------------------------------

  private async executeWithBreaker<T>(op: () => Promise<T>, opName: string): Promise<T> {
    try {
      const result = await op();
      this.recordSuccess();
      return result;
    } catch (err) {
      this.recordFailure(opName, err);
      throw err;
    }
  }

  private assertCircuitClosed(): void {
    const now = Date.now();
    if (this.circuit.openUntil > now) {
      const wait = Math.ceil((this.circuit.openUntil - now) / 1000);
      throw new Error(
        `HederaClient circuit breaker is OPEN (${this.circuit.failures} consecutive failures). ` +
          `Fast-failing requests for ${wait}s more.`,
      );
    }
  }

  private recordSuccess(): void {
    if (this.circuit.failures > 0 || this.circuit.openUntil > 0) {
      // soft-reset after a clean call
      this.circuit = { failures: 0, openUntil: 0 };
    }
  }

  private recordFailure(opName: string, err: unknown): void {
    this.circuit.failures += 1;
    if (this.circuit.failures >= this.circuitFailureThreshold) {
      this.circuit.openUntil = Date.now() + 30_000;
      // eslint-disable-next-line no-console
      console.warn(
        `[HederaClient] circuit OPEN: ${this.circuit.failures} consecutive failures. ` +
          `Last op=${opName}, error=${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  private isTransient(err: unknown): boolean {
    if (!(err instanceof Error)) return false;
    const msg = (err.message || '') + ' ' + (err.name || '');
    return TRANSIENT_PATTERNS.some((p) => msg.includes(p));
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
