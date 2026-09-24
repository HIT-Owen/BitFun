import { beforeEach, describe, expect, it, vi } from 'vitest';
import { webcrypto } from 'node:crypto';

const mocks = vi.hoisted(() => ({
  sessions: new Map(), rollback: vi.fn(), truncate: vi.fn(), emit: vi.fn(),
  capability: vi.fn(), fork: vi.fn(), turns: vi.fn(), pending: vi.fn(), transition: vi.fn(),
}));
vi.mock('@/infrastructure/api', () => ({
  snapshotAPI: { rollbackToTurn: mocks.rollback },
  sessionAPI: { supportsRemoteMessageEdit: mocks.capability, loadSessionTurns: mocks.turns },
}));
vi.mock('@/infrastructure/event-bus', () => ({ globalEventBus: { emit: mocks.emit } }));
vi.mock('@/shared/utils/logger', () => ({ createLogger: () => ({ info: vi.fn() }) }));
vi.mock('../store/FlowChatStore', () => ({ flowChatStore: {
  getState: () => ({ sessions: mocks.sessions }), truncateDialogTurnsFrom: mocks.truncate,
} }));
vi.mock('./FlowChatManager', () => ({ flowChatManager: { forkChatSession: mocks.fork } }));
vi.mock('./flow-chat-manager/PendingQueueModule', () => ({ pendingQueueManager: { list: mocks.pending } }));
vi.mock('../state-machine', () => ({ stateMachineManager: { getCurrentState: () => 'idle', transition: mocks.transition } }));
import { describeUserMessageEditImpact, editAndRerunUserMessage } from './UserMessageEditService';

const request = () => ({ sessionId: 'source', turnId: 'turn-1', turnIndex: 0,
  originalContent: 'old', editedContent: 'new', rerun: vi.fn().mockResolvedValue(undefined) });
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('crypto', webcrypto);
  const storage = new Map<string, string>();
  vi.stubGlobal('localStorage', { getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value), removeItem: (key: string) => storage.delete(key) });
  mocks.sessions.clear();
  mocks.sessions.set('source', { workspacePath: '/work', remoteConnectionId: 'ssh-a', remoteSshHost: 'host-a', config: {},
    dialogTurns: [{ id: 'turn-1', userMessage: { content: 'old' } }] });
  mocks.pending.mockReturnValue([]);
  mocks.capability.mockResolvedValue(true);
  mocks.fork.mockResolvedValue('branch');
  mocks.turns.mockResolvedValue([]);
  mocks.rollback.mockResolvedValue([]);
});
describe('remote message edit', () => {
  it('branches before the selected turn without rolling back files or truncating the original', async () => {
    const input = request();
    await editAndRerunUserMessage(input);
    expect(mocks.fork).toHaveBeenCalledWith('source', 'turn-1', expect.any(String));
    expect(input.rerun).toHaveBeenCalledWith('new', undefined, 'branch', expect.stringMatching(/^remote-edit-/));
    expect(mocks.rollback).not.toHaveBeenCalled();
    expect(mocks.truncate).not.toHaveBeenCalled();
    expect(mocks.sessions.get('source').dialogTurns).toHaveLength(1);
    expect(describeUserMessageEditImpact('source')).toMatchObject({ willBranch: true, willRestoreFiles: false, willDeleteTurns: false });
  });
  it('rejects unsupported hosts and pending work before creating a branch', async () => {
    mocks.capability.mockResolvedValue(false);
    await expect(editAndRerunUserMessage(request())).rejects.toThrow('does not support');
    expect(mocks.fork).not.toHaveBeenCalled();
    mocks.pending.mockReturnValue([{}]);
    await expect(editAndRerunUserMessage(request())).rejects.toThrow('pending queue');
    expect(mocks.fork).not.toHaveBeenCalled();
  });
  it('reuses the branch and turn identities after an uncertain submission failure', async () => {
    const input = request();
    input.rerun.mockRejectedValueOnce(new Error('disconnected'));
    await expect(editAndRerunUserMessage(input)).rejects.toThrow('disconnected');
    const operation = mocks.fork.mock.calls[0][2];
    const turnId = input.rerun.mock.calls[0][3];
    mocks.turns.mockResolvedValue([{ turnId }]);
    await editAndRerunUserMessage(input);
    expect(mocks.fork.mock.calls[1][2]).toBe(operation);
    expect(input.rerun).toHaveBeenCalledTimes(1);
  });
  it('rejects concurrent edits instead of launching a second task', async () => {
    let finish!: (value: boolean) => void;
    mocks.capability.mockReturnValue(new Promise(resolve => { finish = resolve; }));
    const first = editAndRerunUserMessage(request());
    await expect(editAndRerunUserMessage(request())).rejects.toThrow('already in progress');
    finish(true);
    await first;
    expect(mocks.fork).toHaveBeenCalledTimes(1);
  });
  it('keeps the existing local rollback and rerun path', async () => {
    const session = mocks.sessions.get('source');
    delete session.remoteConnectionId;
    delete session.remoteSshHost;
    const input = request();
    await editAndRerunUserMessage(input);
    expect(mocks.rollback).toHaveBeenCalledWith('source', 0, true);
    expect(mocks.truncate).toHaveBeenCalledWith('source', 0);
    expect(mocks.fork).not.toHaveBeenCalled();
    expect(input.rerun).toHaveBeenCalledWith('new', undefined);
  });
});
