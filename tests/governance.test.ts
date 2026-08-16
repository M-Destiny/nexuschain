import { describe, it, expect, beforeEach } from 'vitest';
import { Governance } from '../src/governance.js';
import { makeMockHedera, type MockHedera } from './_mocks.js';

describe('Governance', () => {
  let hedera: MockHedera;
  let gov: Governance;

  beforeEach(() => {
    hedera = makeMockHedera();
    gov = new Governance(hedera as any, '0.0.11111', '0.0.33333');
  });

  it('createProposal assigns a uuid, 7-day deadline, and publishes PROPOSAL_CREATED', async () => {
    const id = await gov.createProposal('Title', 'Desc', 7);
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    const p = await gov.getProposal(id);
    expect(p?.title).toBe('Title');
    expect(p?.status).toBe('active');
    expect(p?.createdBy).toBe('0.0.1001');
    expect(new Date(p!.deadline).getTime() - Date.now()).toBeGreaterThan(6 * 86400_000);
    const [topicId, payload] = hedera.publishMessage.mock.calls[0];
    expect(topicId).toBe('0.0.33333');
    expect(JSON.parse(payload).type).toBe('PROPOSAL_CREATED');
  });

  it('vote adds to forVotes and emits VOTE_CAST', async () => {
    const id = await gov.createProposal('T', 'D', 7);
    await gov.vote(id, true, '1000000');
    const p = await gov.getProposal(id);
    expect(p?.forVotes).toBe('1000000');
    expect(p?.againstVotes).toBe('0');
    const lastCall = hedera.publishMessage.mock.calls.at(-1)!;
    const evt = JSON.parse(lastCall[1]);
    expect(evt.type).toBe('VOTE_CAST');
    expect(evt.support).toBe(true);
    expect(evt.amount).toBe('1000000');
  });

  it('vote against adds to againstVotes', async () => {
    const id = await gov.createProposal('T', 'D', 7);
    await gov.vote(id, false, '500000');
    const p = await gov.getProposal(id);
    expect(p?.againstVotes).toBe('500000');
    expect(p?.forVotes).toBe('0');
  });

  it('vote throws on unknown proposal', async () => {
    await expect(gov.vote('nope', true, '1')).rejects.toThrow('not found');
  });

  it('vote rejects past-deadline proposals and auto-rejects them', async () => {
    const id = await gov.createProposal('T', 'D', 7);
    const p = await gov.getProposal(id);
    p!.deadline = new Date(Date.now() - 1000).toISOString();
    await gov.vote(id, true, '1');
    expect(p?.status).toBe('rejected');
  });

  it('executeProposal passes when forVotes > againstVotes and quorum met', async () => {
    const id = await gov.createProposal('T', 'D', 7);
    await gov.vote(id, true, '6000000');
    await gov.vote(id, false, '4000001');
    await gov.executeProposal(id);
    const p = await gov.getProposal(id);
    expect(p?.status).toBe('passed');
  });

  it('executeProposal rejects when quorum not met', async () => {
    const id = await gov.createProposal('T', 'D', 7);
    await gov.vote(id, true, '100');
    await gov.executeProposal(id);
    const p = await gov.getProposal(id);
    expect(p?.status).toBe('rejected');
  });

  it('executeProposal rejects when againstVotes >= forVotes', async () => {
    const id = await gov.createProposal('T', 'D', 7);
    await gov.vote(id, true, '6000000');
    await gov.vote(id, false, '6000000');
    await gov.executeProposal(id);
    expect((await gov.getProposal(id))?.status).toBe('rejected');
  });

  it('executeProposal throws on unknown id', async () => {
    await expect(gov.executeProposal('nope')).rejects.toThrow('not found');
  });

  it('getActiveProposals filters out non-active', async () => {
    const id1 = await gov.createProposal('T1', 'D', 7);
    await gov.createProposal('T2', 'D', 7);
    await gov.executeProposal(id1);
    expect(gov.getActiveProposals()).toHaveLength(1);
  });

  it('executeProposal sets executableAt = now + timeLockHours for passed proposals', async () => {
    const id = await gov.createProposal('T', 'D', 7);
    await gov.vote(id, true, '6000000');
    await gov.vote(id, false, '4000001');
    const before = Date.now();
    await gov.executeProposal(id);
    const p = await gov.getProposal(id);
    expect(p?.status).toBe('passed');
    expect(p?.executableAt).toBeDefined();
    const execMs = new Date(p!.executableAt!).getTime();
    // Default timeLockHours is 48
    expect(execMs - before).toBeGreaterThan(47 * 3600_000);
    expect(execMs - before).toBeLessThan(49 * 3600_000);
  });

  it('finalizeProposal throws before time-lock elapses', async () => {
    const id = await gov.createProposal('T', 'D', 7);
    await gov.vote(id, true, '6000000');
    await gov.vote(id, false, '4000001');
    await gov.executeProposal(id);
    await expect(gov.finalizeProposal(id)).rejects.toThrow(/Time-lock not yet elapsed/);
  });

  it('finalizeProposal succeeds after time-lock elapses and marks executed', async () => {
    const customGov = new Governance(hedera as any, '0.0.11111', '0.0.33333', { timeLockHours: 0 });
    const id = await customGov.createProposal('T', 'D', 7);
    await customGov.vote(id, true, '6000000');
    await customGov.vote(id, false, '4000001');
    await customGov.executeProposal(id);
    await customGov.finalizeProposal(id);
    const p = await customGov.getProposal(id);
    expect(p?.status).toBe('executed');
  });

  it('finalizeProposal rejects proposals that are not in passed state', async () => {
    const id = await gov.createProposal('T', 'D', 7);
    await gov.vote(id, true, '100'); // below quorum
    await gov.executeProposal(id);
    await expect(gov.finalizeProposal(id)).rejects.toThrow(/not in 'passed' state/);
  });

  it('veto throws when vetoAddress not configured', async () => {
    const id = await gov.createProposal('T', 'D', 7);
    await gov.vote(id, true, '6000000');
    await gov.vote(id, false, '4000001');
    await gov.executeProposal(id);
    await expect(gov.veto(id)).rejects.toThrow(/Veto not configured/);
  });

  it('veto throws when caller is not the veto address', async () => {
    const customGov = new Governance(hedera as any, '0.0.11111', '0.0.33333', { vetoAddress: '0.0.9999' });
    const id = await customGov.createProposal('T', 'D', 7);
    await customGov.vote(id, true, '6000000');
    await customGov.vote(id, false, '4000001');
    await customGov.executeProposal(id);
    await expect(customGov.veto(id)).rejects.toThrow(/Only the veto address/);
  });

  it('veto succeeds when veto address calls on passed proposal before time-lock', async () => {
    const customGov = new Governance(hedera as any, '0.0.11111', '0.0.33333', { vetoAddress: '0.0.1001', timeLockHours: 48 });
    const id = await customGov.createProposal('T', 'D', 7);
    await customGov.vote(id, true, '6000000');
    await customGov.vote(id, false, '4000001');
    await customGov.executeProposal(id);
    await customGov.veto(id);
    const p = await customGov.getProposal(id);
    expect(p?.status).toBe('vetoed');
    expect(p?.vetoVotes).toBe('1');
  });

  it('veto throws after time-lock has elapsed', async () => {
    const customGov = new Governance(hedera as any, '0.0.11111', '0.0.33333', { vetoAddress: '0.0.1001', timeLockHours: 0 });
    const id = await customGov.createProposal('T', 'D', 7);
    await customGov.vote(id, true, '6000000');
    await customGov.vote(id, false, '4000001');
    await customGov.executeProposal(id);
    await customGov.finalizeProposal(id); // time-lock 0 = immediately executable
    await expect(customGov.veto(id)).rejects.toThrow(/time-lock has elapsed/);
  });
});
