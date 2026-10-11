/** True when the project is open read-only (ownership was denied). */
export function isReadOnlyProjectView(readOnlyProjectId: string | null, activeProjectId: string): boolean {
  return readOnlyProjectId !== null && readOnlyProjectId === activeProjectId;
}
