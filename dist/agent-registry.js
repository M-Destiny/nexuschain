import { v4 as uuid } from 'uuid';
export class AgentRegistry {
    hedera;
    topicId;
    agents = new Map();
    constructor(hedera, topicId) {
        this.hedera = hedera;
        this.topicId = topicId;
    }
    async registerAgent(metadata, _privateKey) {
        const id = uuid();
        const agent = { id, ...metadata, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
        this.agents.set(id, agent);
        await this.hedera.publishMessage(this.topicId, JSON.stringify({
            type: 'AGENT_REGISTERED',
            id,
            timestamp: agent.createdAt,
            ...metadata,
        }));
        return id;
    }
    async updateAgent(agentId, updates) {
        const existing = this.agents.get(agentId);
        if (!existing)
            throw new Error(`Agent ${agentId} not found`);
        const updated = { ...existing, ...updates, updatedAt: new Date().toISOString() };
        this.agents.set(agentId, updated);
        await this.hedera.publishMessage(this.topicId, JSON.stringify({
            type: 'AGENT_UPDATED',
            agentId,
            updates,
            timestamp: updated.updatedAt,
        }));
    }
    async getAgent(agentId) {
        return this.agents.get(agentId) ?? null;
    }
    async listAgents(filters) {
        let agents = Array.from(this.agents.values());
        if (filters?.capability) {
            agents = agents.filter(a => a.capabilities.includes(filters.capability));
        }
        if (filters?.minRating !== undefined) {
            agents = agents.filter(a => a.ratings.average >= filters.minRating);
        }
        if (filters?.status) {
            agents = agents.filter(a => a.status === filters.status);
        }
        return agents.sort((a, b) => b.ratings.average - a.ratings.average);
    }
    async deactivateAgent(agentId) {
        await this.updateAgent(agentId, { status: 'deprecated' });
        await this.hedera.publishMessage(this.topicId, JSON.stringify({
            type: 'AGENT_DEACTIVATED',
            agentId,
            timestamp: new Date().toISOString(),
        }));
    }
    async rateAgent(agentId, rating) {
        const agent = this.agents.get(agentId);
        if (!agent)
            throw new Error(`Agent ${agentId} not found`);
        const newCount = agent.ratings.count + 1;
        const newAverage = ((agent.ratings.average * agent.ratings.count) + rating) / newCount;
        await this.updateAgent(agentId, {
            ratings: { average: Math.round(newAverage * 10) / 10, count: newCount },
        });
    }
}
//# sourceMappingURL=agent-registry.js.map