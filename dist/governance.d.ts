import { HederaClient } from './hedera/client.js';
import type { GovernanceProposal } from './types.js';
export declare class Governance {
    private hedera;
    private tokenId;
    private proposalTopicId;
    private proposals;
    constructor(hedera: HederaClient, _tokenId: string, proposalTopicId: string);
    createProposal(title: string, description: string, durationDays?: number): Promise<string>;
    vote(proposalId: string, support: boolean, amount: string): Promise<void>;
    getProposal(proposalId: string): Promise<GovernanceProposal | null>;
    executeProposal(proposalId: string): Promise<void>;
    getActiveProposals(): GovernanceProposal[];
}
//# sourceMappingURL=governance.d.ts.map