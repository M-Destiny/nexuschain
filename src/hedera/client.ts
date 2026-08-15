import { Client, AccountId, PrivateKey, TopicId, TopicMessageSubmitTransaction, TopicCreateTransaction, AccountBalanceQuery } from '@hashgraph/sdk';

export class HederaClient {
  private client: Client;
  private accountId: string;
  private privateKey: string;

  constructor(config: { accountId: string; privateKey: string; network: 'mainnet' | 'testnet' | 'previewnet' }) {
    this.accountId = config.accountId;
    this.privateKey = config.privateKey;
    this.client = Client.forNetwork({
      mainnet: { '35.237.200.180:50211': new AccountId(0, 0, 1) },
      testnet: { '0.0.3': new AccountId(0, 0, 3) },
      previewnet: { '0.0.4': new AccountId(0, 0, 4) },
    }[config.network]);
    this.client.setOperator(new AccountId(this.accountId), PrivateKey.fromString(this.privateKey));
  }

  async createTopic(name: string): Promise<string> {
    const tx = await new TopicCreateTransaction()
      .setTopicMemo(name)
      .execute(this.client);
    const receipt = await tx.getReceipt(this.client);
    if (!receipt.topicId) throw new Error('Failed to create topic');
    return receipt.topicId.toString();
  }

  async publishMessage(topicId: string, message: string): Promise<string> {
    const tx = await new TopicMessageSubmitTransaction()
      .setTopicId(TopicId.fromString(topicId))
      .setMessage(message)
      .execute(this.client);
    const receipt = await tx.getReceipt(this.client);
    return receipt.topicSequenceNumber?.toString() ?? '';
  }

  async getAccountBalance(): Promise<{ hbar: number; tinybars: string }> {
    const query = new AccountBalanceQuery()
      .setAccountId(this.accountId)
      .execute(this.client);
    const balance = await query;
    return {
      hbar: balance.hbars.toBigNumber().toNumber(),
      tinybars: balance.hbars.toString(),
    };
  }

  getOperatorAccountId(): string {
    return this.accountId;
  }

  getClient(): Client {
    return this.client;
  }
}
