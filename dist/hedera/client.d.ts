import { Client } from '@hashgraph/sdk';
export declare class HederaClient {
    private client;
    private accountId;
    private privateKey;
    constructor(config: {
        accountId: string;
        privateKey: string;
        network: 'mainnet' | 'testnet' | 'previewnet';
    });
    createTopic(name: string): Promise<string>;
    publishMessage(topicId: string, message: string): Promise<string>;
    getAccountBalance(): Promise<{
        hbar: number;
        tinybars: string;
    }>;
    getOperatorAccountId(): string;
    getClient(): Client;
}
//# sourceMappingURL=client.d.ts.map