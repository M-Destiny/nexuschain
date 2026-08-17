export { HederaClient } from './hedera/client.js';
export { AgentRegistry } from './agent-registry.js';
export { Marketplace } from './marketplace.js';
export { Governance } from './governance.js';
export type * from './types.js';

// Typechain-generated contract types for type-safe Solidity interaction
export type {
  NexusChainMarketplace,
  NexusChainMarketplaceInterface,
  AgentDeactivatedEvent,
  AgentListedEvent,
  AgentPurchasedEvent,
  AgentRatedEvent,
  AgentRegisteredEvent,
  AgentUpgradedEvent,
  ProposalCreatedEvent,
  ProposalExecutedEvent,
  VoteCastEvent,
} from '../typechain-types';
