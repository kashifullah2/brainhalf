import { describe, it, expect } from 'vitest';
import { isReadOnlyProjectView } from '../components/Workspace';

describe('isReadOnlyProjectView', () => {
  it('is true only when the read-only marker matches the active project', () => {
    expect(isReadOnlyProjectView('proj-1', 'proj-1')).toBe(true);
  });

  it('is false when no project is marked read-only', () => {
    expect(isReadOnlyProjectView(null, 'proj-1')).toBe(false);
  });

  it('is false when a different project is marked read-only', () => {
    expect(isReadOnlyProjectView('proj-2', 'proj-1')).toBe(false);
  });

  it('treats the marker as project-scoped, not a global lock', () => {
    // Switching projects must not keep the editor locked: the marker only
    // applies while it equals the active project id.
    expect(isReadOnlyProjectView('proj-1', 'proj-2')).toBe(false);
    expect(isReadOnlyProjectView('proj-2', 'proj-2')).toBe(true);
  });
});
