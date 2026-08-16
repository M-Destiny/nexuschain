import { HederaClient } from './hedera/client.js';
import type { GovernanceProposal } from './types.js';
import { v4 as uuid } from 'uuid';

export class Governance {
  private hedera: HederaClient;
  private proposalTopicId: string;
  private timeLockHours: number;
  private proposals = new Map<string, GovernanceProposal>();

  constructor(
    hedera: HederaClient,
    _tokenId: string,
    proposalTopicId: string,
    options: { timeLockHours?: number } = {},
  ) {
    this.hedera = hedera;
    this.proposalTopicId = proposalTopicId;
    // After a proposal passes, the executable action is delayed by this
    // many hours so the community has time to react to malicious proposals
    // or governance attacks. Configurable so test environments can shorten it.
    this.timeLockHours = options.timeLockHours ?? 48;
    // _tokenId reserved for future HTS governance-token integration (votes-weighted-by-HTS-balance)
    void _tokenId;
  }

  async createProposal(title: string, description: string, durationDays = 7): Promise<string> {
    const id = uuid();
    const deadline = new Date(Date.now() + durationDays * 24 * 60 * 60 * 1000).toISOString();
    const proposal: GovernanceProposal = {
      id,
      title,
      description,
      forVotes: '0',
      againstVotes: '0',
      status: 'active',
      createdBy: this.hedera.getOperatorAccountId(),
      deadline,
      quorum: '10000000', // 10 HBAR in tinybars
    };
    this.proposals.set(id, proposal);

    await this.hedera.publishMessage(this.proposalTopicId, JSON.stringify({
      type: 'PROPOSAL_CREATED',
      id,
      title,
      description,
      deadline,
      timestamp: new Date().toISOString(),
    }));

    return id;
  }

  async vote(proposalId: string, support: boolean, amount: string): Promise<void> {
    const proposal = this.proposals.get(proposalId);
    if (!proposal) throw new Error(`Proposal ${proposalId} not found`);
    if (proposal.status !== 'active') throw new Error('Proposal is not active');
    if (new Date(proposal.deadline) < new Date()) {
      proposal.status = 'rejected';
      return;
    }

    if (support) {
      proposal.forVotes = String(BigInt(proposal.forVotes) + BigInt(amount));
    } else {
      proposal.againstVotes = String(BigInt(proposal.againstVotes) + BigInt(amount));
    }

    await this.hedera.publishMessage(this.proposalTopicId, JSON.stringify({
      type: 'VOTE_CAST',
      proposalId,
      support,
      amount,
      voter: this.hedera.getOperatorAccountId(),
      timestamp: new Date().toISOString(),
    }));
  }

  async getProposal(proposalId: string): Promise<GovernanceProposal | null> {
    return this.proposals.get(proposalId) ?? null;
  }

  /**
   * Tally votes and mark the proposal 'passed' or 'rejected'.
   * If 'passed', also set `executableAt` = now + timeLockHours so the
   * caller can act on the proposal only after the time-lock elapses.
   *
   * Without a time-lock, a hostile quorum could pass a treasury-drain
   * proposal and execute it in the same block. The 48-hour buffer gives
   * token-holders time to exit or coordinate a counter-proposal.
   */
  async executeProposal(proposalId: string): Promise<void> {
    const proposal = this.proposals.get(proposalId);
    if (!proposal) throw new Error(`Proposal ${proposalId} not found`);

    const forVotes = BigInt(proposal.forVotes);
    const againstVotes = BigInt(proposal.againstVotes);
    const quorum = BigInt(proposal.quorum);

    if (forVotes + againstVotes < quorum) {
      proposal.status = 'rejected';
    } else if (forVotes > againstVotes) {
      proposal.status = 'passed';
      proposal.executableAt = new Date(
        Date.now() + this.timeLockHours * 60 * 60 * 1000,
      ).toISOString();
    } else {
      proposal.status = 'rejected';
    }

    await this.hedera.publishMessage(this.proposalTopicId, JSON.stringify({
      type: 'PROPOSAL_EXECUTED',
      proposalId,
      status: proposal.status,
      executableAt: proposal.executableAt,
      timestamp: new Date().toISOString(),
    }));
  }

  /**
   * Final-step call: invoke the on-chain action for a passed proposal.
   * Enforces the time-lock — throws if called before `executableAt`.
   * Once invoked, the proposal is marked 'executed' permanently.
   */
  async finalizeProposal(proposalId: string): Promise<void> {
    const proposal = this.proposals.get(proposalId);
    if (!proposal) throw new Error(`Proposal ${proposalId} not found`);
    if (proposal.status !== 'passed') {
      throw new Error(`Proposal ${proposalId} is not in 'passed' state (current: ${proposal.status})`);
    }
    if (!proposal.executableAt) {
      throw new Error(`Proposal ${proposalId} has no executableAt timestamp`);
    }
    if (new Date(proposal.executableAt) > new Date()) {
      throw new Error(
        `Time-lock not yet elapsed for ${proposalId}; executable at ${proposal.executableAt}`,
      );
    }
    proposal.status = 'executed';
    await this.hedera.publishMessage(this.proposalTopicId, JSON.stringify({
      type: 'PROPOSAL_FINALIZED',
      proposalId,
      timestamp: new Date().toISOString(),
    }));
  }

  getActiveProposals(): GovernanceProposal[] {
    return Array.from(this.proposals.values()).filter(p => p.status === 'active');
  }
}
