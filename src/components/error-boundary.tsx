import {
  Component,
  type ComponentType,
  type ErrorInfo,
  type ReactNode,
} from 'react';

export interface ErrorFallbackProps {
  error: Error;
  resetError: () => void;
}

interface ErrorBoundaryProps {
  children: ReactNode;
  FallbackComponent?: ComponentType<ErrorFallbackProps>;
  /** Changing this clears a caught error. Pass the route to recover on navigation. */
  resetKey?: unknown;
}

interface ErrorBoundaryState {
  error: Error | null;
}

function toError(value: unknown): Error {
  if (value instanceof Error) {
    return value;
  }
  if (typeof value === 'string') {
    return new Error(value);
  }
  try {
    return new Error(JSON.stringify(value));
  } catch {
    return new Error(String(value));
  }
}

function DefaultFallback({ error, resetError }: ErrorFallbackProps) {
  return (
    <div className="min-h-[60vh] w-full flex items-center justify-center p-6">
      <div className="max-w-lg w-full text-center bg-card p-6 rounded-xl border border-destructive/20 shadow-lg">
        <div className="w-12 h-12 rounded-full bg-destructive/10 text-destructive flex items-center justify-center mx-auto mb-4 font-semibold text-xl">
          !
        </div>
        <h1 className="text-xl font-semibold text-foreground">
          Something went wrong
        </h1>
        <p className="mt-2 text-body text-muted-foreground">
          This part of the app hit an error. The rest of the app is still running.
        </p>
        
        <pre className="mt-4 max-h-40 overflow-y-auto rounded-xl bg-muted/60 p-3 text-left font-mono text-label text-destructive border border-destructive/20 whitespace-pre-wrap break-all">
          {error.message || String(error)}
        </pre>

        <div className="mt-6 flex justify-center gap-3">
          <button
            type="button"
            onClick={() => {
              resetError();
              window.location.reload();
            }}
            className="rounded-lg bg-primary px-5 py-2.5 text-body font-semibold text-primary-foreground shadow-sm transition-colors hover:bg-primary/90"
          >
            Reload Page
          </button>
          <button
            type="button"
            onClick={resetError}
            className="rounded-lg border border-border bg-muted px-5 py-2.5 text-body font-semibold text-foreground transition-colors hover:bg-muted/80"
          >
            Try Again
          </button>
        </div>
      </div>
    </div>
  );
}

export class ErrorBoundary extends Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: unknown): ErrorBoundaryState {
    return { error: toError(error) };
  }

  componentDidCatch(error: unknown, info: ErrorInfo): void {
    console.error(
      'ErrorBoundary caught an error:',
      toError(error),
      info.componentStack,
    );
  }

  componentDidUpdate(prevProps: ErrorBoundaryProps): void {
    if (
      this.state.error !== null &&
      prevProps.resetKey !== this.props.resetKey
    ) {
      this.resetError();
    }
  }

  resetError = (): void => {
    this.setState({ error: null });
  };

  render(): ReactNode {
    const { error } = this.state;
    if (error === null) {
      return this.props.children;
    }
    const Fallback = this.props.FallbackComponent ?? DefaultFallback;
    return <Fallback error={error} resetError={this.resetError} />;
  }
}
