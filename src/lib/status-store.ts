import { useState, useEffect } from 'react';
import { appEvents } from './events';
import { getProjectMessages } from './project-store';

export type PlatformStatus = 'Ready' | 'Building' | 'Error' | 'Stopped' | 'Connecting';

export interface StatusVisuals {
  status: PlatformStatus;
  topBarLabel: string;
  modelPanelLabel: string;
  dotColor: string;
  glow: string;
  isBuilding: boolean;
}

// Module-level single source of truth state
let globalStatus: PlatformStatus = 'Ready';
let globalDetail: string = '';
let activeGeneratingProjectId: string | null = null;

export function getStatusVisuals(status: PlatformStatus): StatusVisuals {
  switch (status) {
    case 'Building':
      return {
        status: 'Building',
        topBarLabel: 'Building',
        modelPanelLabel: 'Building',
        dotColor: '#3b82f6',
        glow: '0 0 6px rgba(59, 130, 246, 0.7)',
        isBuilding: true,
      };
    case 'Error':
      return {
        status: 'Error',
        topBarLabel: 'Error',
        modelPanelLabel: 'Error',
        dotColor: '#ef4444',
        glow: 'none',
        isBuilding: false,
      };
    case 'Stopped':
      return {
        status: 'Stopped',
        topBarLabel: 'Stopped',
        modelPanelLabel: 'Stopped',
        dotColor: '#f59e0b',
        glow: 'none',
        isBuilding: false,
      };
    case 'Connecting':
      return {
        status: 'Connecting',
        topBarLabel: 'Connecting',
        modelPanelLabel: 'Connecting',
        dotColor: '#f59e0b',
        glow: 'none',
        isBuilding: false,
      };
    case 'Ready':
    default:
      return {
        status: 'Ready',
        topBarLabel: 'Ready',
        modelPanelLabel: 'Active',
        dotColor: 'var(--color-success)',
        glow: '0 0 6px rgba(16, 185, 129, 0.6)',
        isBuilding: false,
      };
  }
}

/**
 * Calculates platform status for a given project.
 * Core business rules enforced:
 * 1. 'Building' should ONLY show while BrainHalf AI is actively generating code after a prompt is submitted.
 * 2. On a fresh/empty project with no prompt sent yet, the status should read 'Ready' or 'Idle', not 'Building'.
 * 3. Top-bar status and model-panel status pull from this exact same source of truth.
 */
export function resolvePlatformStatusForProject(projectId: string): PlatformStatus {
  if (!projectId) return 'Ready';

  // Rule 1 & 2: Check if any user prompt has ever been submitted to this project
  const msgs = getProjectMessages(projectId);
  const hasUserPrompt = Boolean(msgs && msgs.some(m => m && m.role === 'user'));

  if (!hasUserPrompt) {
    // Fresh/empty project with no user prompt submitted yet -> ALWAYS 'Ready'
    return 'Ready';
  }

  // If in 'Building' state, only the project currently generating code reflects 'Building'
  if (globalStatus === 'Building') {
    return activeGeneratingProjectId === projectId ? 'Building' : 'Ready';
  }

  return globalStatus;
}

export function setPlatformStatus(newStatus: PlatformStatus, detail: string = '', projectId?: string) {
  if (newStatus === 'Building') {
    activeGeneratingProjectId = projectId || activeGeneratingProjectId;
  } else {
    if (!projectId || activeGeneratingProjectId === projectId) {
      activeGeneratingProjectId = null;
    }
  }
  globalStatus = newStatus;
  globalDetail = detail;

  appEvents.emit('platform-status-sync', {
    status: newStatus,
    detail,
    projectId,
    activeGeneratingProjectId
  });
}

export function resetPlatformStatusToReady(projectId?: string) {
  if (!projectId || activeGeneratingProjectId === projectId) {
    activeGeneratingProjectId = null;
  }
  globalStatus = 'Ready';
  globalDetail = '';
  appEvents.emit('platform-status-sync', {
    status: 'Ready',
    detail: '',
    projectId,
    activeGeneratingProjectId
  });
}

/**
 * Single source of truth reactive hook for platform and project status.
 * Both TopNav and ChatPanel consume this hook.
 */
export function usePlatformStatus(activeProjectId: string): StatusVisuals {
  const [currentStatus, setCurrentStatus] = useState<PlatformStatus>(() =>
    resolvePlatformStatusForProject(activeProjectId)
  );

  useEffect(() => {
    // Re-evaluate immediately upon activeProjectId switch
    setCurrentStatus(resolvePlatformStatusForProject(activeProjectId));

    const handleSync = (payload?: {
      status?: PlatformStatus;
      detail?: string;
      projectId?: string;
      activeGeneratingProjectId?: string | null;
    }) => {
      if (payload?.status) {
        if (payload.status === 'Building') {
          globalStatus = 'Building';
          activeGeneratingProjectId = payload.projectId || payload.activeGeneratingProjectId || activeGeneratingProjectId;
        } else {
          globalStatus = payload.status;
          if (!payload.projectId || activeGeneratingProjectId === payload.projectId) {
            activeGeneratingProjectId = null;
          }
        }
      }
      setCurrentStatus(resolvePlatformStatusForProject(activeProjectId));
    };

    const handleGen = (payload: { status: string; detail?: string; error?: string; projectId?: string }) => {
      if (payload.status === 'Generating' || payload.status === 'Writing files') {
        globalStatus = 'Building';
        activeGeneratingProjectId = payload.projectId || activeProjectId;
      } else if (payload.status === 'Error' || payload.status === 'Failed') {
        globalStatus = 'Error';
        activeGeneratingProjectId = null;
      } else if (payload.status === 'Stopped' || payload.status === 'Cancelled') {
        globalStatus = 'Stopped';
        activeGeneratingProjectId = null;
      } else if (payload.status === 'Connecting') {
        globalStatus = 'Connecting';
      } else {
        globalStatus = 'Ready';
        activeGeneratingProjectId = null;
      }
      globalDetail = payload.detail || payload.error || '';
      setCurrentStatus(resolvePlatformStatusForProject(activeProjectId));
    };

    const handleMessagesUpdated = (payload?: { projectId?: string }) => {
      if (!payload?.projectId || payload.projectId === activeProjectId) {
        setCurrentStatus(resolvePlatformStatusForProject(activeProjectId));
      }
    };

    const handleClear = () => {
      resetPlatformStatusToReady(activeProjectId);
      setCurrentStatus('Ready');
    };

    const unsubSync = appEvents.on('platform-status-sync', handleSync);
    const unsubGen = appEvents.on('generation-status', handleGen);
    const unsubMsg = appEvents.on('project-messages-updated', handleMessagesUpdated);
    const unsubClear = appEvents.on('clear-workspace', handleClear);

    return () => {
      unsubSync();
      unsubGen();
      unsubMsg();
      unsubClear();
    };
  }, [activeProjectId]);

  return getStatusVisuals(currentStatus);
}
