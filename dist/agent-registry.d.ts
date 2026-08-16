import { HederaClient } from './hedera/client.js';
import type { AgentMetadata, AgentFilter } from './types.js';
export declare class AgentRegistry {
    private hedera;
    private topicId;
    private agents;
    constructor(hedera: HederaClient, topicId: string);
    registerAgent(metadata: Omit<AgentMetadata, 'id'>, _privateKey: string): Promise<string>;
    updateAgent(agentId: string, updates: Partial<AgentMetadata>): Promise<void>;
    getAgent(agentId: string): Promise<AgentMetadata | null>;
    listAgents(filters?: AgentFilter): Promise<AgentMetadata[]>;
    deactivateAgent(agentId: string): Promise<void>;
    rateAgent(agentId: string, rating: number): Promise<void>;
    /**
     * Upgrade an agent to a new version + IPFS metadata CID. Emits an
     * AGENT_UPGRADED event so consumers (indexers, marketplace listings)
     * can repoint to the new artifact. The new version must be strictly
     * higher than the current one (semver-style numeric comparison).
     *
     * Downgrades are rejected to prevent rolling back to a vulnerable build.
     */
    upgradeAgent(agentId: string, newVersion: string, newIpfsCid: string): Promise<void>;
}
//# sourceMappingURL=agent-registry.d.ts.map