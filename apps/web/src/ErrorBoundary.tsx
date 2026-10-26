import { Component, type ErrorInfo, type ReactNode } from "react";

/** Shows the real error on screen instead of a blank page. */
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("App crashed", error, info.componentStack);
  }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <main className="mx-auto max-w-xl space-y-3 p-6">
        <h1 className="text-xl font-semibold">Something went wrong</h1>
        <p className="text-sm text-muted-foreground">Take a screenshot of this and send it to Claude. Build {__BUILD__}.</p>
        <pre role="alert" className="overflow-x-auto whitespace-pre-wrap rounded-md bg-muted p-3 text-xs text-danger">
          {this.state.error.message}
          {"\n"}
          {this.state.error.stack?.split("\n").slice(1, 6).join("\n")}
        </pre>
        <button className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground" onClick={() => location.reload()}>
          Reload
        </button>
      </main>
    );
  }
}
