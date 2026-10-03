import { useState, useEffect } from 'react';
import { appEvents } from './events';
import { getProjectMessages, getProjectStorageScope } from './project-store';

export type PlatformStatus = 'Ready' | 'Building' | 'Error' | 'Stopped' | 'Connecting';

export interface StatusVisuals {
  status: PlatformStatus;
  topBarLabel: string;
  modelPanelLabel: string;
  dotColor: string;
  glow: string;
  isBuilding: boolean;
  /** Human-readable reason for Error/Stopped states, if known. */
  detail?: string;
}

const projectStatuses = new Map<string, PlatformStatus>();
const projectDetails = new Map<string, string>();
const previewErrors = new Set<string>();
let statusScope = getProjectStorageScope();

function ensureStatusScope(): void {
  const current = getProjectStorageScope();
  if (current === statusScope) return;
  statusScope = current;
  projectStatuses.clear();
  projectDetails.clear();
  previewErrors.clear();
}

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
        dotColor: '#6b7280',
        glow: 'none',
        isBuilding: false,
      };
    case 'Connecting':
      return {
        status: 'Connecting',
        topBarLabel: 'Connecting',
        modelPanelLabel: 'Connecting',
        dotColor: '#3b82f6',
        glow: '0 0 6px rgba(59, 130, 246, 0.7)',
        isBuilding: false,
      };
    case 'Ready':
    default:
      return {
        status: 'Ready',
        topBarLabel: 'Ready',
        modelPanelLabel: 'Ready',
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
  ensureStatusScope();
  if (!projectId) return 'Ready';
  const status = projectStatuses.get(projectId) || 'Ready';
  if (status !== 'Building' && previewErrors.has(projectId)) return 'Error';
  const msgs = getProjectMessages(projectId);
  const hasUserPrompt = Boolean(msgs && msgs.some(m => m && m.role === 'user'));
  return status === 'Building' && !hasUserPrompt ? 'Ready' : status;
}

export function setPlatformStatus(newStatus: PlatformStatus, detail: string = '', projectId?: string) {
  ensureStatusScope();
  if (!projectId) return;
  projectStatuses.set(projectId, newStatus);
  if (detail) projectDetails.set(projectId, detail);
  else projectDetails.delete(projectId);
  appEvents.emit('platform-status-sync', {
    status: newStatus,
    detail,
    projectId,
  });
}

export function resetPlatformStatusToReady(projectId?: string) {
  if (projectId) {
    projectStatuses.delete(projectId);
    projectDetails.delete(projectId);
    previewErrors.delete(projectId);
  } else {
    projectStatuses.clear();
    projectDetails.clear();
    previewErrors.clear();
  }
  appEvents.emit('platform-status-sync', {
    status: 'Ready',
    detail: '',
    projectId,
  });
}

export function setPreviewStatus(projectId: string, status: 'Ready' | 'Error') {
  ensureStatusScope();
  if (status === 'Error') previewErrors.add(projectId);
  else previewErrors.delete(projectId);
  appEvents.emit('platform-status-sync', { projectId });
}

/**
 * Single source of truth reactive hook for platform and project status.
 * Both TopNav and ChatPanel consume this hook.
 */
export function usePlatformStatus(activeProjectId: string): StatusVisuals {
  const [, setRevision] = useState(0);
  const currentStatus = resolvePlatformStatusForProject(activeProjectId);

  useEffect(() => {
    const handleSync = (payload?: { projectId?: string }) => {
      if (!payload?.projectId || payload.projectId === activeProjectId) {
        setRevision(value => value + 1);
      }
    };

    const handleGen = (payload: { status: string; detail?: string; error?: string; projectId?: string }) => {
      let status: PlatformStatus;
      if (payload.status === 'Generating' || payload.status === 'Writing files') {
        status = 'Building';
      } else if (payload.status === 'Error' || payload.status === 'Failed') {
        status = 'Error';
      } else if (payload.status === 'Stopped' || payload.status === 'Cancelled') {
        status = 'Stopped';
      } else if (payload.status === 'Connecting') {
        status = 'Connecting';
      } else if (payload.status === 'Ready') {
        status = 'Ready';
      } else {
        status = 'Ready';
      }
      setPlatformStatus(status, payload.detail || payload.error || '', payload.projectId || activeProjectId);
    };

    const handlePreviewState = (payload?: { projectId: string; state: 'loading' | 'ready' | 'error'; error?: string }) => {
      if (!payload?.projectId) return;
      ensureStatusScope();
      const generationStatus = projectStatuses.get(payload.projectId);
      const preserveGeneration = generationStatus === 'Building' || generationStatus === 'Error' || generationStatus === 'Stopped';
      if (payload.state === 'error') {
        setPreviewStatus(payload.projectId, 'Error');
      } else if (payload.state === 'loading') {
        if (!preserveGeneration) setPlatformStatus('Connecting', 'Preparing preview', payload.projectId);
      } else {
        setPreviewStatus(payload.projectId, 'Ready');
        if (!preserveGeneration) setPlatformStatus('Ready', 'Preview ready', payload.projectId);
      }
    };

    const handleMessagesUpdated = (payload?: { projectId?: string }) => {
      if (!payload?.projectId || payload.projectId === activeProjectId) {
        setRevision(value => value + 1);
      }
    };

    const handleClear = () => {
      resetPlatformStatusToReady(activeProjectId);
      setRevision(value => value + 1);
    };

    const unsubSync = appEvents.on('platform-status-sync', handleSync);
    const unsubGen = appEvents.on('generation-status', handleGen);
    const unsubPreview = appEvents.on('preview-state', handlePreviewState);
    const unsubMsg = appEvents.on('project-messages-updated', handleMessagesUpdated);
    const unsubClear = appEvents.on('clear-workspace', handleClear);

    return () => {
      unsubSync();
      unsubGen();
      unsubPreview();
      unsubMsg();
      unsubClear();
    };
  }, [activeProjectId]);

  const detail = projectDetails.get(activeProjectId);
  const visuals = getStatusVisuals(currentStatus);
  return detail ? { ...visuals, detail } : visuals;
}
