import { HederaClient } from './hedera/client.js';
import type { GovernanceProposal } from './types.js';
import { v4 as uuid } from 'uuid';

export class Governance {
  private hedera: HederaClient;
  private proposalTopicId: string;
  private proposals = new Map<string, GovernanceProposal>();

  constructor(hedera: HederaClient, _tokenId: string, proposalTopicId: string) {
    this.hedera = hedera;
    this.proposalTopicId = proposalTopicId;
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
    } else {
      proposal.status = 'rejected';
    }

    await this.hedera.publishMessage(this.proposalTopicId, JSON.stringify({
      type: 'PROPOSAL_EXECUTED',
      proposalId,
      status: proposal.status,
      timestamp: new Date().toISOString(),
    }));
  }

  getActiveProposals(): GovernanceProposal[] {
    return Array.from(this.proposals.values()).filter(p => p.status === 'active');
  }
}
