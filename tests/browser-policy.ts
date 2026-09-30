export const LOCAL_BROWSER_SPECS = [
  '**/project-console.spec.ts',
  '**/account-isolation.spec.ts',
  '**/audit-remediation.spec.ts',
  '**/edge-preview-remediation.spec.ts',
  '**/ai-ide-e2e-001-lifecycle.spec.ts',
  '**/platform-checks-regression.spec.ts',
  '**/critical-remediation.spec.ts',
  '**/recent-projects.spec.ts',
  '**/workspace-clarity.spec.ts',
  '**/managed-runtime.spec.ts',
  '**/nontechnical-flow.spec.ts',
  '**/gallery.spec.ts',
  '**/agent-tools.spec.ts',
  '**/ui-popover-menu.spec.ts',
  '**/ui-dashboard-header.spec.ts',
  '**/ui-chat-autoscroll.spec.ts',
  '**/ui-login-modal.spec.ts',
];

export function requireLiveTestOptIn(environment: Record<string, string | undefined>) {
  if (environment.BRAINHALF_ALLOW_LIVE_TESTS !== '1') {
    throw new Error('Legacy/live suites can call paid providers and mutate production. Set BRAINHALF_ALLOW_LIVE_TESTS=1 only with explicit permission and controlled test accounts.');
  }
}
