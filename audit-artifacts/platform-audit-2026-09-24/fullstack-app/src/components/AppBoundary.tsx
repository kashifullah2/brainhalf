import { Component, type ReactNode } from "react";

export default class AppBoundary extends Component<{ children: ReactNode }, { error: string | null }> {
  state: { error: string | null } = { error: null };
  static getDerivedStateFromError(error: unknown) { return { error: error instanceof Error ? error.message : "The application could not render" }; }
  render() { return this.state.error ? <main className="welcome" role="alert"><h1>Something went wrong</h1><p>{this.state.error}</p><button onClick={() => this.setState({ error: null })}>Try again</button></main> : this.props.children; }
}
