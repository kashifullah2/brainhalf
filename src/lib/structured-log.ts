type LogLevel = 'info' | 'warn' | 'error';

/**
 * Emit a structured JSON log line. CF Logpush picks these up and forwards
 * them to Axiom/Datadog/etc., where they can be queried by field.
 *
 * Keep hot-path callsites lean: pass only fields needed to diagnose the event.
 */
export function structuredLog(
  level: LogLevel,
  event: string,
  fields: Record<string, unknown> = {}
): void {
  const line = JSON.stringify({ ts: Date.now(), level, event, ...fields });
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
}
