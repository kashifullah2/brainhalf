export function safeCatch(
  signal: AbortSignal,
  setter: (message: string) => void,
  fallback = 'Something went wrong.',
): (cause: unknown) => void {
  return (cause: unknown) => {
    if (signal.aborted) return;
    setter(cause instanceof Error ? cause.message : fallback);
  };
}
