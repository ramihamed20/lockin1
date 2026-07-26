import { Component } from "react";

export class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error("[Dentify ErrorBoundary]", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <section className="panel error-panel" style={{ textAlign: "center", padding: "var(--space-10)" }}>
          <h2 style={{ marginBottom: "var(--space-4)" }}>Something went wrong</h2>
          <p style={{ color: "var(--muted)", marginBottom: "var(--space-6)" }}>
            {this.state.error?.message || "An unexpected error occurred."}
          </p>
          <button
            className="btn btn-primary"
            onClick={() => this.setState({ hasError: false, error: null })}
          >
            Try again
          </button>
        </section>
      );
    }

    return this.props.children;
  }
}
