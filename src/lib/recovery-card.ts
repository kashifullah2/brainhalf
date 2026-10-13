/**
 * B1: Recovery-card decision logic for the "No response received" state.
 *
 * When a generation fails, the chat panel shows a recovery card. The critical
 * distinction this module captures:
 *
 * - Model failure (no connectionError): the socket is fine, the model just
 *   didn't answer. "Try again" resends on the live connection.
 * - Connection failure (connectionError set): the socket is dead or the
 *   server rejected it. A plain resend loops forever on the same dead
 *   socket, so the card must offer "Reconnect & try again" instead.
 *
 * Kept as a pure function so the rule is unit-testable without mounting
 * the full ChatPanel.
 */

export interface RecoveryCardState {
  /** Why the last connection attempt failed, if it did. */
  connectionError: string | null;
  /** Whether the workspace socket is currently open. */
  isConnected: boolean;
  /** RC-4: set when a 4401 close arrived while a generation was active. */
  sessionExpiredDuringGeneration?: boolean;
}

export interface RecoveryCardDecision {
  /** Card heading. */
  title: string;
  /** Body text. Falls back to the generic message when no cause is known. */
  body: string;
  /** Label for the primary action button. */
  actionLabel: 'Reconnect & try again' | 'Try again';
  /** True when the primary action must reconnect first. */
  needsReconnect: boolean;
  /** RC-4: true when the primary action should open the sign-in flow. */
  needsSignIn?: boolean;
}

export const GENERIC_NO_RESPONSE_BODY =
  'No reply is available for this message. Your prompt is saved. Try again, or select another model below.';

export const SESSION_EXPIRED_DURING_GENERATION_BODY =
  'Your session expired while the builder was working. Sign in again to resume.';

export function decideRecoveryCard(state: RecoveryCardState): RecoveryCardDecision {
  if (state.sessionExpiredDuringGeneration) {
    return {
      title: 'Session expired',
      body: SESSION_EXPIRED_DURING_GENERATION_BODY,
      actionLabel: 'Try again',
      needsReconnect: false,
      needsSignIn: true,
    };
  }
  if (state.connectionError && !state.isConnected) {
    return {
      title: 'Connection problem',
      body: state.connectionError,
      actionLabel: 'Reconnect & try again',
      needsReconnect: true,
    };
  }
  return {
    title: 'No response received',
    body: GENERIC_NO_RESPONSE_BODY,
    actionLabel: 'Try again',
    needsReconnect: false,
  };
}

/**
 * RC-5: build the "Resuming interrupted build" status detail shown when
 * a generation_notice with resumedFrom arrives. N comes from the local
 * project store so it reflects files written before the disconnect.
 */
export function buildResumeNotice(fileCount: number): string {
  return fileCount > 0
    ? `Resuming interrupted build (${fileCount} file${fileCount === 1 ? '' : 's'} already saved)…`
    : 'Resuming interrupted build…';
}
