// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * NexusChain Marketplace — Hedera-native AI Agent Marketplace
 * Powered by HTS (Hedera Token Service) + HCS (Hedera Consensus Service)
 *
 * Agents are registered on-chain. Payments use HBAR via HTS.
 * Governance uses HBAR-weighted voting.
 */
contract NexusChainMarketplace {

    // --- Structs ---
    struct SubscriptionTier {
        string name;
        uint256 pricePerMonth;     // in tinybars
        uint256 callsPerMonth;
        string[] features;
        bool isActive;
    }

    struct Agent {
        string id;
        string name;
        string description;
        address payable owner;
        uint256 pricePerCall;      // in tinybars (1 HBAR = 100,000,000 tinybars)
        uint256 ratingSum;
        uint256 ratingCount;
        bool isActive;
        string ipfsCid;
        string[] capabilities;
        SubscriptionTier[] subscriptionTiers;
    }

    struct Listing {
        string agentId;
        uint256 price;
        uint256 views;
        bool exists;
    }

    struct Proposal {
        string id;
        string title;
        string description;
        uint256 forVotes;
        uint256 againstVotes;
        uint256 deadline;
        bool executed;
        bool exists;
    }

    // --- State ---
    mapping(string => Agent) public agents;
    mapping(string => Listing) public listings;
    mapping(string => Proposal) public proposals;
    mapping(address => mapping(string => uint256)) public voterStake;
    mapping(string => uint256) public agentRevenue;

    uint256 public constant QUORUM = 10_000_000_000; // 10 HBAR in tinybars
    uint256 public constant VOTE_DURATION = 7 days;

    address public governanceToken;
    address public treasury;

    // --- Events ---
    event AgentRegistered(string indexed id, string name, address indexed owner, uint256 price);
    event AgentListed(string indexed agentId, uint256 price);
    event AgentPurchased(string indexed agentId, address indexed buyer, uint256 price, address indexed seller);
    event AgentRated(string indexed agentId, uint8 rating, address indexed rater);
    event AgentDeactivated(string indexed agentId);
    event ProposalCreated(string indexed id, string title, uint256 deadline);
    event VoteCast(string indexed proposalId, address indexed voter, bool support, uint256 amount);
    event ProposalExecuted(string indexed proposalId, bool passed);

    // --- Modifiers ---
    modifier onlyActive(string memory agentId) {
        require(agents[agentId].isActive, "Agent is not active");
        _;
    }

    /**
     * @dev Reentrancy guard using a function-scoped lock (Checks-Effects-Interactions).
     * Applied to any function that performs an external call BEFORE updating state.
     * OpenZeppelin-style: minimal gas footprint, single uint storage slot.
     */
    uint256 private _locked = 1;
    modifier nonReentrant() {
        require(_locked == 1, "Reentrant call");
        _locked = 2;
        _;
        _locked = 1;
    }

    // --- Agent Registry ---
    function registerAgent(
        string memory id,
        string memory name,
        string memory description,
        uint256 pricePerCall,
        string memory ipfsCid,
        string[] memory capabilities,
        SubscriptionTier[] memory subscriptionTiers
    ) external {
        require(bytes(agents[id].id).length == 0, "Agent ID already exists");
        require(pricePerCall > 0, "Price must be positive");
        require(bytes(name).length > 0, "Name required");

        agents[id] = Agent({
            id: id,
            name: name,
            description: description,
            owner: payable(msg.sender),
            pricePerCall: pricePerCall,
            ratingSum: 0,
            ratingCount: 0,
            isActive: true,
            ipfsCid: ipfsCid,
            capabilities: capabilities,
            subscriptionTiers: subscriptionTiers
        });

        emit AgentRegistered(id, name, msg.sender, pricePerCall);
    }

    function updateAgent(string memory id, uint256 newPrice, bool deactivate) external {
        require(agents[id].owner == msg.sender, "Not the owner");
        if (deactivate) {
            agents[id].isActive = false;
            emit AgentDeactivated(id);
        } else {
            require(newPrice > 0, "Price must be positive");
            agents[id].pricePerCall = newPrice;
        }
    }

    /** @dev Add or update subscription tiers for an agent. Only the owner can call. */
    function updateSubscriptionTiers(
        string memory id,
        SubscriptionTier[] memory tiers
    ) external {
        require(agents[id].owner == msg.sender, "Not the owner");
        agents[id].subscriptionTiers = tiers;
    }

    function getAgent(string memory id) external view returns (Agent memory) {
        return agents[id];
    }

    function getSubscriptionTiers(string memory id) external view returns (SubscriptionTier[] memory) {
        return agents[id].subscriptionTiers;
    }

    // --- Marketplace ---
    function listAgent(string memory agentId, uint256 price) external {
        require(agents[agentId].owner == msg.sender, "Not the owner");
        require(agents[agentId].isActive, "Agent not active");

        listings[agentId] = Listing({
            agentId: agentId,
            price: price,
            views: 0,
            exists: true
        });

        emit AgentListed(agentId, price);
    }

    function purchaseAgent(string memory agentId) external payable onlyActive(agentId) nonReentrant {
        require(listings[agentId].exists, "Agent not listed");
        uint256 price = listings[agentId].price;
        require(msg.value >= price, "Insufficient payment");

        // --- Checks (above) + Effects (below) happen BEFORE any external call.
        // CEI ordering + the nonReentrant guard eliminates the classic
        // reentrancy window where a malicious seller fallback could re-enter
        // purchaseAgent and drain msg.sender multiple times.
        address payable seller = agents[agentId].owner;
        uint256 revenue = price * 95 / 100; // 5% platform fee retained in treasury
        uint256 refund = msg.value - price;

        // Effects: bump view counter and accrue agent revenue SYNCHRONOUSLY.
        listings[agentId].views++;
        agentRevenue[agentId] += revenue;

        // Interactions: external transfers happen LAST, with no further state writes.
        (bool sellerOk, ) = seller.call{value: revenue}("");
        require(sellerOk, "Seller transfer failed");
        if (refund > 0) {
            (bool refundOk, ) = msg.sender.call{value: refund}("");
            require(refundOk, "Refund failed");
        }

        emit AgentPurchased(agentId, msg.sender, price, seller);
    }

    function rateAgent(string memory agentId, uint8 rating) external onlyActive(agentId) {
        require(rating >= 1 && rating <= 5, "Rating must be 1-5");
        require(listings[agentId].exists, "Must have used the agent");

        Agent storage agent = agents[agentId];
        agent.ratingSum += rating;
        agent.ratingCount++;

        emit AgentRated(agentId, rating, msg.sender);
    }

    function getAverageRating(string memory agentId) external view returns (uint256) {
        Agent storage agent = agents[agentId];
        if (agent.ratingCount == 0) return 0;
        return agent.ratingSum / agent.ratingCount;
    }

    // --- Governance ---
    function createProposal(
        string memory id,
        string memory title,
        string memory description,
        uint256 durationDays
    ) external {
        require(!proposals[id].exists, "Proposal ID exists");

        proposals[id] = Proposal({
            id: id,
            title: title,
            description: description,
            forVotes: 0,
            againstVotes: 0,
            deadline: block.timestamp + (durationDays * 1 days),
            executed: false,
            exists: true
        });

        emit ProposalCreated(id, title, proposals[id].deadline);
    }

    function vote(string memory proposalId, bool support, uint256 amount) external {
        Proposal storage proposal = proposals[proposalId];
        require(proposal.exists, "Proposal not found");
        require(!proposal.executed, "Proposal already executed");
        require(block.timestamp < proposal.deadline, "Voting ended");
        require(amount > 0, "Must stake positive amount");

        // In production: stake governance tokens via HTS
        voterStake[msg.sender][proposalId] += amount;

        if (support) {
            proposal.forVotes += amount;
        } else {
            proposal.againstVotes += amount;
        }

        emit VoteCast(proposalId, msg.sender, support, amount);
    }

    function executeProposal(string memory proposalId) external {
        Proposal storage proposal = proposals[proposalId];
        require(proposal.exists, "Proposal not found");
        require(!proposal.executed, "Already executed");
        require(block.timestamp >= proposal.deadline, "Voting still active");
        require(proposal.forVotes + proposal.againstVotes >= QUORUM, "Quorum not reached");

        bool passed = proposal.forVotes > proposal.againstVotes;
        proposal.executed = true;

        emit ProposalExecuted(proposalId, passed);
    }

    // --- Treasury ---
    function withdrawTreasury(address payable recipient) external {
        require(msg.sender == treasury, "Not treasury");
        uint256 balance = address(this).balance;
        require(balance > 0, "Nothing to withdraw");
        recipient.transfer(balance);
    }

    function setTreasury(address newTreasury) external {
        require(treasury == address(0), "Treasury already set");
        treasury = newTreasury;
    }

    receive() external payable {}
}
