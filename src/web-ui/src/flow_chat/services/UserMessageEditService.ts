import { snapshotAPI, sessionAPI } from '@/infrastructure/api';
import { globalEventBus } from '@/infrastructure/event-bus';
import { createLogger } from '@/shared/utils/logger';
import { flowChatStore } from '../store/FlowChatStore';
import { pendingQueueManager } from './flow-chat-manager/PendingQueueModule';
import { stateMachineManager } from '../state-machine';
import { SessionExecutionEvent, SessionExecutionState } from '../state-machine/types';
import { isRemoteWorkspaceSession, requireSessionProjectWorkspacePath } from '../utils/sessionWorkspace';
import { acpAgentTypeFromSession, isAcpAgentType } from '../utils/acpSession';

const activeEdits = new Set<string>();
const log = createLogger('UserMessageEditService');

export interface UserMessageEditImpact {
  willStopRunningTask: boolean;
  willRestoreFiles: boolean;
  willDeleteTurns: boolean;
  willRerun: boolean;
  willBranch: boolean;
}

export interface EditAndRerunUserMessageRequest {
  sessionId: string;
  turnId: string;
  turnIndex: number;
  originalContent: string;
  editedContent: string;
  agentType?: string;
  rerun: (content: string, agentType?: string, targetSessionId?: string, turnId?: string) => Promise<void>;
}

export function describeUserMessageEditImpact(sessionId: string): UserMessageEditImpact {
  const currentState = stateMachineManager.getCurrentState(sessionId);
  const remote = isRemoteWorkspaceSession(flowChatStore.getState().sessions.get(sessionId), null);
  return {
    willStopRunningTask:
      remote || currentState === SessionExecutionState.PROCESSING ||
      currentState === SessionExecutionState.FINISHING,
    willRestoreFiles: !remote,
    willDeleteTurns: !remote,
    willBranch: remote,
    willRerun: true,
  };
}

export function canEditUserMessage(request: {
  sessionId?: string | null;
  turnIndex: number;
  hasImages?: boolean;
  isUsageReportMessage?: boolean;
  steeringStatus?: string;
  isRemoteSession?: boolean;
  isSubmitting?: boolean;
}): boolean {
  return Boolean(
    request.sessionId &&
      request.turnIndex >= 0 &&
      !request.hasImages &&
      !request.isUsageReportMessage &&
      !request.steeringStatus &&
      !request.isSubmitting,
  );
}

export async function editAndRerunUserMessage(
  request: EditAndRerunUserMessageRequest,
): Promise<void> {
  if (activeEdits.has(request.sessionId)) throw new Error('A message edit is already in progress');
  activeEdits.add(request.sessionId);
  try {
    await performEditAndRerun(request);
  } finally {
    activeEdits.delete(request.sessionId);
  }
}

async function performEditAndRerun(request: EditAndRerunUserMessageRequest): Promise<void> {
  const trimmedEditedContent = request.editedContent.trim();
  if (!trimmedEditedContent) {
    throw new Error('Edited message cannot be empty');
  }

  if (trimmedEditedContent === request.originalContent.trim()) {
    return;
  }

  const session = flowChatStore.getState().sessions.get(request.sessionId);
  if (!session) {
    throw new Error(`Session does not exist: ${request.sessionId}`);
  }

  const targetTurn = session.dialogTurns[request.turnIndex];
  if (!targetTurn || targetTurn.id !== request.turnId) {
    throw new Error('Message edit target is no longer available');
  }

  const triggerSource = targetTurn.userMessage.metadata?.triggerSource;
  if (triggerSource && triggerSource !== 'desktop_ui') {
    throw new Error('Only messages sent from the desktop chat input can be edited');
  }

  if (pendingQueueManager.list(request.sessionId).length > 0) {
    throw new Error('Edit the message after clearing the pending queue');
  }

  if (isRemoteWorkspaceSession(session, null)) {
    if (acpAgentTypeFromSession(session) || isAcpAgentType(request.agentType)) {
      throw new Error('Remote message editing is not supported for external ACP sessions');
    }
    if (!(await sessionAPI.supportsRemoteMessageEdit())) {
      throw new Error('This execution host does not support remote message branching. Update the host before retrying.');
    }
    // Retain the operation on uncertain failure; only a digest and UUID are stored.
    const identity = JSON.stringify([session.remoteConnectionId, session.remoteSshHost, session.workspacePath, request.sessionId, request.turnId, request.editedContent]);
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(identity));
    const key = `bitfun:remote-message-edit:${Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('')}`;
    const operationId = localStorage.getItem(key) ?? crypto.randomUUID();
    localStorage.setItem(key, operationId);
    const { flowChatManager } = await import('./FlowChatManager');
    const targetSessionId = await flowChatManager.forkChatSession(request.sessionId, request.turnId, operationId);
    const rerunTurnId = `remote-edit-${operationId}`;
    const persistedTurns = await sessionAPI.loadSessionTurns(
      targetSessionId, requireSessionProjectWorkspacePath(session, request.sessionId), undefined,
      session.remoteConnectionId ?? session.config.remoteConnectionId,
      session.remoteSshHost ?? session.config.remoteSshHost,
    );
    if (!persistedTurns.some(turn => turn.turnId === rerunTurnId)) {
      await request.rerun(trimmedEditedContent, request.agentType, targetSessionId, rerunTurnId);
    }
    localStorage.removeItem(key);
    return;
  }

  const currentState = stateMachineManager.getCurrentState(request.sessionId);
  if (currentState === SessionExecutionState.PROCESSING || currentState === SessionExecutionState.FINISHING) {
    await stateMachineManager.transition(request.sessionId, SessionExecutionEvent.USER_CANCEL);
  } else if (currentState === SessionExecutionState.ERROR) {
    await stateMachineManager.transition(request.sessionId, SessionExecutionEvent.RESET);
  }

  log.info('Editing user message and rerunning from turn', {
    sessionId: request.sessionId,
    turnIndex: request.turnIndex,
    turnId: request.turnId,
  });

  const restoredFiles = await snapshotAPI.rollbackToTurn(request.sessionId, request.turnIndex, true);

  flowChatStore.truncateDialogTurnsFrom(request.sessionId, request.turnIndex);

  globalEventBus.emit('file-tree:refresh');
  restoredFiles.forEach(filePath => {
    globalEventBus.emit('editor:file-changed', { filePath });
  });

  await request.rerun(trimmedEditedContent, request.agentType);
}
