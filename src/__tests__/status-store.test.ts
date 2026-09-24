import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  resolvePlatformStatusForProject,
  setPlatformStatus,
  resetPlatformStatusToReady,
  getStatusVisuals,
  setPreviewStatus
} from '../lib/status-store';
import { saveProjectMessages, setProjectAccount } from '../lib/project-store';

describe('Status Store & Platform Status Single Source of Truth', () => {
  let mockStorage: Record<string, string> = {};

  beforeEach(() => {
    setProjectAccount(null);
    mockStorage = {};
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => mockStorage[key] || null,
      setItem: (key: string, val: string) => { mockStorage[key] = val; },
      removeItem: (key: string) => { delete mockStorage[key]; },
      clear: () => { mockStorage = {}; }
    });
    resetPlatformStatusToReady();
    setProjectAccount('test-account');
  });

  it('keeps preview errors visible after generation reports Ready', () => {
    saveProjectMessages('preview-error', [{ role: 'user', content: 'Build' }]);
    setPreviewStatus('preview-error', 'Error');
    setPlatformStatus('Ready', 'Generated', 'preview-error');
    expect(resolvePlatformStatusForProject('preview-error')).toBe('Error');
    setPreviewStatus('preview-error', 'Ready');
    expect(resolvePlatformStatusForProject('preview-error')).toBe('Ready');
  });

  it('does not leak errors or resets between projects', () => {
    saveProjectMessages('project-error-a', [{ role: 'user', content: 'A' }]);
    saveProjectMessages('project-error-b', [{ role: 'user', content: 'B' }]);
    setPlatformStatus('Error', 'Failed', 'project-error-a');
    setPreviewStatus('project-error-b', 'Error');
    resetPlatformStatusToReady('project-error-b');
    expect(resolvePlatformStatusForProject('project-error-a')).toBe('Error');
    expect(resolvePlatformStatusForProject('project-error-b')).toBe('Ready');
  });

  it('does not retain project errors across account switches', () => {
    setPreviewStatus('shared-project', 'Error');
    expect(resolvePlatformStatusForProject('shared-project')).toBe('Error');
    setProjectAccount('another-account');
    expect(resolvePlatformStatusForProject('shared-project')).toBe('Ready');
  });

  it('reports a fresh-project preview error without requiring chat history', () => {
    setPreviewStatus('fresh-preview-error', 'Error');
    expect(resolvePlatformStatusForProject('fresh-preview-error')).toBe('Error');
    expect(resolvePlatformStatusForProject('another-fresh-project')).toBe('Ready');
  });

  it('does not erase a generation failure when preview rendering succeeds', () => {
    setPlatformStatus('Error', 'Generation failed', 'separate-errors');
    setPreviewStatus('separate-errors', 'Ready');
    expect(resolvePlatformStatusForProject('separate-errors')).toBe('Error');
  });

  describe('Rule 1: Fresh / Empty Project with No Prompt Sent', () => {
    it('returns "Ready" on a project with no messages saved', () => {
      const status = resolvePlatformStatusForProject('fresh-project-1');
      expect(status).toBe('Ready');
    });

    it('returns "Ready" when project only has an AI welcome greeting and no user prompt', () => {
      saveProjectMessages('fresh-project-2', [
        { role: 'ai', content: 'What kind of application would you like to build today?' }
      ]);
      const status = resolvePlatformStatusForProject('fresh-project-2');
      expect(status).toBe('Ready');
    });

    it('never shows "Building" on a fresh project even if globalStatus was set to Building', () => {
      setPlatformStatus('Building', 'AI is busy', 'other-project');
      const status = resolvePlatformStatusForProject('fresh-project-3');
      expect(status).toBe('Ready');
    });
  });

  describe('Rule 2: "Building" Only Shows While Actively Generating Code After Prompt Submission', () => {
    it('shows "Building" when project has a prompt and is actively generating', () => {
      const projId = 'active-proj-1';
      saveProjectMessages(projId, [
        { role: 'user', content: 'Create a chess game in React' }
      ]);
      setPlatformStatus('Building', 'Generating code...', projId);

      const status = resolvePlatformStatusForProject(projId);
      expect(status).toBe('Building');
    });

    it('does NOT show "Building" on another project while active-proj-1 is building', () => {
      const projA = 'proj-a';
      const projB = 'proj-b';
      saveProjectMessages(projA, [{ role: 'user', content: 'Build app A' }]);
      saveProjectMessages(projB, [{ role: 'user', content: 'Build app B' }]);

      setPlatformStatus('Building', 'Generating A', projA);

      expect(resolvePlatformStatusForProject(projA)).toBe('Building');
      expect(resolvePlatformStatusForProject(projB)).toBe('Ready');
    });

    it('transitions back to "Ready" once generation completes', () => {
      const projId = 'active-proj-2';
      saveProjectMessages(projId, [{ role: 'user', content: 'Build calculator' }]);
      setPlatformStatus('Building', 'Generating...', projId);
      expect(resolvePlatformStatusForProject(projId)).toBe('Building');

      setPlatformStatus('Ready', 'Generation complete', projId);
      expect(resolvePlatformStatusForProject(projId)).toBe('Ready');
    });

    it('transitions to "Stopped" when user stops generation', () => {
      const projId = 'active-proj-3';
      saveProjectMessages(projId, [{ role: 'user', content: 'Build complex website' }]);
      setPlatformStatus('Building', 'Generating...', projId);
      expect(resolvePlatformStatusForProject(projId)).toBe('Building');

      setPlatformStatus('Stopped', 'Generation stopped by user', projId);
      expect(resolvePlatformStatusForProject(projId)).toBe('Stopped');
    });

    it('transitions to "Error" when generation fails', () => {
      const projId = 'active-proj-4';
      saveProjectMessages(projId, [{ role: 'user', content: 'Build app' }]);
      setPlatformStatus('Building', 'Generating...', projId);

      setPlatformStatus('Error', 'Connection lost', projId);
      expect(resolvePlatformStatusForProject(projId)).toBe('Error');
    });
  });

  describe('Rule 3: Top-Bar and Model-Panel Status Synchronization & Single Source of Truth', () => {
    it('uses the same Ready label for the top bar and agent panel', () => {
      const visuals = getStatusVisuals('Ready');
      expect(visuals.topBarLabel).toBe('Ready');
      expect(visuals.modelPanelLabel).toBe('Ready');
      expect(visuals.dotColor).toBe('var(--color-success)');
      expect(visuals.isBuilding).toBe(false);
    });

    it('verifies visuals for "Building" state: Both read "Building", both blue dot with glow', () => {
      const visuals = getStatusVisuals('Building');
      expect(visuals.topBarLabel).toBe('Building');
      expect(visuals.modelPanelLabel).toBe('Building');
      expect(visuals.dotColor).toBe('#3b82f6');
      expect(visuals.glow).toContain('rgba(59, 130, 246');
      expect(visuals.isBuilding).toBe(true);
    });

    it('verifies visuals for "Stopped" state: both labels read "Stopped" with a green dot', () => {
      const visuals = getStatusVisuals('Stopped');
      expect(visuals.topBarLabel).toBe('Stopped');
      expect(visuals.modelPanelLabel).toBe('Stopped');
      expect(visuals.dotColor).toBe('#10b981');
      expect(visuals.isBuilding).toBe(false);
    });

    it('verifies visuals for "Error" state: Both read "Error", both red dot', () => {
      const visuals = getStatusVisuals('Error');
      expect(visuals.topBarLabel).toBe('Error');
      expect(visuals.modelPanelLabel).toBe('Error');
      expect(visuals.dotColor).toBe('#ef4444');
      expect(visuals.isBuilding).toBe(false);
    });

    it('verifies visuals for "Connecting" state: both labels read "Connecting" with a blue dot', () => {
      const visuals = getStatusVisuals('Connecting');
      expect(visuals.topBarLabel).toBe('Connecting');
      expect(visuals.modelPanelLabel).toBe('Connecting');
      expect(visuals.dotColor).toBe('#3b82f6');
      expect(visuals.isBuilding).toBe(false);
    });
  });
});
