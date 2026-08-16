import { HederaClient } from './hedera/client.js';
import type { GovernanceProposal } from './types.js';
export interface GovernanceOptions {
    /** Hours after a proposal passes before it can be executed. Default 48. */
    timeLockHours?: number;
    /** Minimum quorum in tinybars required for proposal validity. Default 10 HBAR (10_000_000 tinybars). */
    minQuorum?: string;
    /** Address of a veto holder (e.g., multisig). If set, this address can veto passed proposals. */
    vetoAddress?: string;
}
export declare class Governance {
    private hedera;
    private proposalTopicId;
    private timeLockHours;
    private minQuorum;
    private vetoAddress?;
    private proposals;
    constructor(hedera: HederaClient, _tokenId: string, proposalTopicId: string, options?: GovernanceOptions);
    createProposal(title: string, description: string, durationDays?: number): Promise<string>;
    vote(proposalId: string, support: boolean, amount: string): Promise<void>;
    veto(proposalId: string): Promise<void>;
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
    getVetoAddress(): string | undefined;
}
//# sourceMappingURL=governance.d.ts.map