# NexusChain — Specification

> **Spec Kit: graphify + ponytail development approach**

## 1. Concept & Vision

NexusChain is a decentralized AI agent marketplace where developers can register AI agents, monetize them via HBAR payments, and govern the protocol through HBAR-weighted DAO proposals. Built on Hedera's HCS for state consensus and HTS for tokenized payments.

## 2. Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                      NEXUSCHAIN ARCHITECTURE                     │
│                                                                  │
│  ┌──────────┐    ┌────────────────┐    ┌─────────────────────┐ │
│  │ Agent    │───▶│ Hedera HCS     │───▶│ NexusChainMarketplace│ │
│  │ Registry │    │ (manifest feed) │    │   (Solidity v0.8)   │ │
│  └──────────┘    └────────────────┘    └──────────┬──────────┘ │
│                                                    │             │
│  ┌──────────┐    ┌────────────────┐              │             │
│  │Marketplace│◀───│ HBAR/HTS      │◀─────────────┘             │
│  │(buy/rate)│    │ (payments)     │                             │
│  └──────────┘    └────────────────┘                             │
│                                                                  │
│  ┌──────────┐    ┌────────────────┐                             │
│  │Governance│───▶│ HBAR-weighted  │                             │
│  │(proposals│    │ voting (HCS)   │                             │
│  └──────────┘    └────────────────┘                             │
└─────────────────────────────────────────────────────────────────┘
```

## 3. Tech Stack

| Layer | Technology |
|---|---|
| Runtime | Node.js 20, TypeScript 5, ESM |
| Blockchain | @hashgraph/sdk 2.81, Solidity 0.8+ |
| CLI | Commander.js |
| Config | js-yaml, Zod |
| Logging | Pino |

## 4. Core Modules

### `HederaClient` (`src/hedera/client.ts`)
- Exponential backoff retry for HCS transient errors
- Circuit breaker (5 failures → 30s fast-fail)
- `createTopic(name)` → HCS topic ID
- `publishMessage(topicId, message)` → sequence number
- `getAccountBalance()` → HBAR balance

### `AgentRegistry` (`src/agent-registry.ts`)
- `registerAgent(metadata, privateKey)` → agent ID
- `updateAgent(agentId, metadata)`
- `getAgent(agentId)` → full metadata
- `listAgents(filter?)` → paginated list
- `deactivateAgent(agentId)`

### `Marketplace` (`src/marketplace.ts`)
- `listAgent(agentId, priceHBAR)` → listing
- `purchaseAgent(agentId, buyerId)` → payment + access grant
- `rateAgent(agentId, stars)` → on-chain rating

### `Governance` (`src/governance.ts`)
- `createProposal(title, desc, days)` → proposal ID
- `vote(proposalId, for/against, amountHBAR)` → weighted vote
- `executeProposal(proposalId)` → if quorum met
- `getActiveProposals()` → list

## 5. CLI Commands

```bash
nexuschain init                          # Create nexuschain.config.yaml
nexuschain register <name>              # Register agent
nexuschain list                         # List marketplace
nexuschain buy <agentId>                # Purchase access
nexuschain rate <agentId> --stars 5    # Rate agent
nexuschain balance                      # Check HBAR balance
nexuschain info                         # Show config
nexuschain governance proposals         # List proposals
nexuschain governance vote <id> --for   # Vote
```

## 6. Smart Contract (Solidity 0.8+)

```
Marketplace.sol:
├── AgentRegistry
│   ├── registerAgent(id, metadataCID, pricePerCall, capabilities)
│   ├── getAgent(id) → metadata
│   └── deactivateAgent(id)
├── Marketplace
│   ├── listAgent(agentId, price)
│   ├── purchaseAgent(agentId) [payable]
│   └── rateAgent(agentId, stars)
├── GovernanceToken (HTS-backed)
│   ├── transfer(to, amount)
│   └── balanceOf(account) → uint256
└── Governance
    ├── createProposal(id, title, description, durationBlocks)
    ├── vote(proposalId, support, amountHBAR)
    ├── executeProposal(proposalId)
    └── getProposal(id) → status/votes
```

## 7. Deployment

| Platform | Config | Notes |
|---|---|---|
| Vercel | `vercel.json` | Auto-deploy on push |
| Fly.io | `fly.toml` | Edge global |
| Railway | `railway.json` | Connect repo |
| Render | `render.yaml` | Blueprint |

## 8. Environment Variables

| Variable | Description |
|---|---|
| `HEDERA_ACCOUNT_ID` | `0.0.xxxxx` account |
| `HEDERA_PRIVATE_KEY` | Private key (keep secret!) |
| `HEDERA_NETWORK` | `mainnet` \| `testnet` \| `previewnet` |

## 9. Milestones

- [x] Phase 1: Core modules + CLI (this build)
- [x] Phase 2: Smart contract written
- [ ] Phase 3: Full test coverage
- [ ] Phase 4: Hardhat deployment scripts
- [ ] Phase 5: IPFS integration for metadata
- [ ] Phase 6: Frontend dashboard
