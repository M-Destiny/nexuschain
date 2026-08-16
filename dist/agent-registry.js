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
    /**
     * Upgrade an agent to a new version + IPFS metadata CID. Emits an
     * AGENT_UPGRADED event so consumers (indexers, marketplace listings)
     * can repoint to the new artifact. The new version must be strictly
     * higher than the current one (semver-style numeric comparison).
     *
     * Downgrades are rejected to prevent rolling back to a vulnerable build.
     */
    async upgradeAgent(agentId, newVersion, newIpfsCid) {
        const agent = this.agents.get(agentId);
        if (!agent)
            throw new Error(`Agent ${agentId} not found`);
        if (!newVersion || newVersion.trim() === '') {
            throw new Error('New version is required');
        }
        if (compareVersions(newVersion, agent.version) <= 0) {
            throw new Error(`New version ${newVersion} must be higher than current ${agent.version}`);
        }
        const previousVersion = agent.version;
        const updated = {
            ...agent,
            version: newVersion,
            ipfsCid: newIpfsCid,
            updatedAt: new Date().toISOString(),
        };
        this.agents.set(agentId, updated);
        await this.hedera.publishMessage(this.topicId, JSON.stringify({
            type: 'AGENT_UPGRADED',
            agentId,
            fromVersion: previousVersion,
            toVersion: newVersion,
            ipfsCid: newIpfsCid,
            timestamp: updated.updatedAt,
        }));
    }
}
/**
 * Compare two dot-separated semver-ish strings (e.g. "1.2.3" vs "1.10.0").
 * Returns >0 if a > b, <0 if a < b, 0 if equal. Non-numeric segments
 * fall back to lexicographic comparison.
 */
function compareVersions(a, b) {
    const pa = a.split('.');
    const pb = b.split('.');
    const len = Math.max(pa.length, pb.length);
    for (let i = 0; i < len; i++) {
        const na = pa[i] ?? '0';
        const nb = pb[i] ?? '0';
        const naNum = /^\d+$/.test(na) ? parseInt(na, 10) : NaN;
        const nbNum = /^\d+$/.test(nb) ? parseInt(nb, 10) : NaN;
        if (!Number.isNaN(naNum) && !Number.isNaN(nbNum)) {
            if (naNum !== nbNum)
                return naNum - nbNum;
        }
        else if (na !== nb) {
            return na < nb ? -1 : 1;
        }
    }
    return 0;
}
//# sourceMappingURL=agent-registry.js.map