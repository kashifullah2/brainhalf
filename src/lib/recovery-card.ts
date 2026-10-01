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
}

export const GENERIC_NO_RESPONSE_BODY =
  'No reply is available for this message. Your prompt is saved. Try again, or select another model below.';

export function decideRecoveryCard(state: RecoveryCardState): RecoveryCardDecision {
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
