import { HederaClient } from './client.js';
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
}
//# sourceMappingURL=agent-registry.d.ts.map