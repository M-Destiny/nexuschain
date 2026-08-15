# 🔗 NexusChain

> On-chain AI agent marketplace powered by Hedera — deploy, monetize, and govern AI agents via smart contracts and HCS.

```
┌─────────────────────────────────────────────────────────────┐
│                    NEXUSCHAIN                                │
│                                                              │
│  ┌─────────────┐    ┌──────────────┐   ┌───────────────┐  │
│  │ Agent       │───▶│ Hedera HCS   │──▶│ Smart Contract│  │
│  │ Registry    │    │ (state feed) │   │ (marketplace) │  │
│  └─────────────┘    └──────────────┘   └───────┬───────┘  │
│                                               │            │
│  ┌─────────────┐    ┌──────────────┐          │            │
│  │ Marketplace │◀───│ HBAR/HTS    │◀─────────┘            │
│  │ (buy/rate)  │    │ (payments)   │                       │
│  └─────────────┘    └──────────────┘                       │
│                                                              │
│  ┌─────────────┐    ┌──────────────┐                       │
│  │ Governance  │───▶│ HBAR-weighted│                       │
│  │ (proposals) │    │ voting (HCS)  │                       │
│  └─────────────┘    └──────────────┘                       │
└─────────────────────────────────────────────────────────────┘
```

## Features

| Feature | Description |
|---|---|
| **On-chain Registry** | Agent metadata on Hedera Consensus Service (HCS) |
| **Smart Marketplace** | HBAR payments via HTS — 5% platform fee, instant settlement |
| **IPFS Metadata** | Agent configs pinned to IPFS (Pinata/Web3.Storage) |
| **Reputation** | Star ratings stored on-chain, weighted by stake |
| **Governance** | HBAR-weighted DAO proposals with quorum + execution |
| **CLI** | Full CLI: register, list, buy, rate, governance commands |
| **Solidity Contracts** | Full marketplace + governance + HTS token integration |

## Quick Start

```bash
npm install
npm run build

# Initialize config
nexuschain init
# Edit nexuschain.config.yaml with your Hedera account

# Register an agent
nexuschain register "CodeGen Agent" \
  --desc "Generates TypeScript code from prompts" \
  --price 1 \
  --capabilities code-gen,typescript,ai

# List marketplace
nexuschain list

# Check HBAR balance
nexuschain balance
```

## CLI Commands

```bash
nexuschain init                           Initialize config
nexuschain register <name>                Register agent on-chain
nexuschain list                          List all agents
nexuschain buy <agentId>                 Purchase agent access
nexuschain rate <agentId> --stars 5     Rate an agent
nexuschain balance                        Check HBAR balance
nexuschain info                          Show current config

# Governance
nexuschain governance proposals           List active proposals
nexuschain governance create --title "..." --desc "..."
nexuschain governance vote <proposalId> --for
```

## Architecture

```
CLI (Commander.js)
    │
    ├── HederaClient ──▶ HCS topics (manifest, governance, usage)
    │                    HTS transfers (HBAR payments)
    │                    Account balance queries
    │
    ├── AgentRegistry ──▶ Register/update/deactivate agents
    │                      IPFS CID storage + HCS events
    │
    ├── Marketplace ────▶ List/purchase/rate agents
    │                      Payment escrow via smart contract
    │
    └── Governance ────▶ Create/vote/execute proposals
                         HBAR-weighted voting
```

## Smart Contract (NexusChainMarketplace.sol)

```solidity
// Core functions
registerAgent(id, name, description, pricePerCall, ipfsCid, capabilities)
updateAgent(id, newPrice, deactivate)
listAgent(agentId, price)
purchaseAgent(agentId)  // payable — transfers HBAR
rateAgent(agentId, rating)  // 1-5 stars

// Governance
createProposal(id, title, description, durationDays)
vote(proposalId, support, amount)  // HBAR-weighted
executeProposal(proposalId)  // admin-only after deadline
```

## Hedera Network Support

| Network | Use |
|---|---|
| `mainnet` | Production HBAR payments |
| `testnet` | Development + testing |
| `previewnet` | Pre-release features |

## Deploy

| Platform | Command |
|---|---|
| **Vercel** | `vercel --prod` |
| **Fly.io** | `fly launch && fly deploy` |
| **Railway** | Connect repo → auto-deploy |
| **Render** | `render.yaml` → Blueprint |

## Environment Variables

```bash
HEDERA_ACCOUNT_ID=0.0.xxxxx    # Your Hedera account
HEDERA_PRIVATE_KEY=xxxxx        # Private key (keep secret!)
HEDERA_NETWORK=testnet          # mainnet | testnet | previewnet
```

## License

MIT — M-Destiny
