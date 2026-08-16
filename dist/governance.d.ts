import { HederaClient } from './hedera/client.js';
import type { GovernanceProposal } from './types.js';
export declare class Governance {
    private hedera;
    private proposalTopicId;
    private timeLockHours;
    private proposals;
    constructor(hedera: HederaClient, _tokenId: string, proposalTopicId: string, options?: {
        timeLockHours?: number;
    });
    createProposal(title: string, description: string, durationDays?: number): Promise<string>;
    vote(proposalId: string, support: boolean, amount: string): Promise<void>;
    getProposal(proposalId: string): Promise<GovernanceProposal | null>;
    /**
     * Tally votes and mark the proposal 'passed' or 'rejected'.
     * If 'passed', also set `executableAt` = now + timeLockHours so the
     * caller can act on the proposal only after the time-lock elapses.
     *
     * Without a time-lock, a hostile quorum could pass a treasury-drain
     * proposal and execute it in the same block. The 48-hour buffer gives
     * token-holders time to exit or coordinate a counter-proposal.
     */
    executeProposal(proposalId: string): Promise<void>;
    /**
     * Final-step call: invoke the on-chain action for a passed proposal.
     * Enforces the time-lock — throws if called before `executableAt`.
     * Once invoked, the proposal is marked 'executed' permanently.
     */
    finalizeProposal(proposalId: string): Promise<void>;
    getActiveProposals(): GovernanceProposal[];
}
//# sourceMappingURL=governance.d.ts.map