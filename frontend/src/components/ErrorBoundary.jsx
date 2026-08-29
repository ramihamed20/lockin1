import { Component } from "react";
import { isStaleClientError, reloadForUpdate } from "../lib/lazyWithRecovery.js";

export class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    this.props.onError?.({ error, errorInfo });
  }

  render() {
    if (this.state.hasError) {
      const staleClient = isStaleClientError(this.state.error);
      return (
        <section className="panel error-panel app-recovery-panel" role="alert">
          <h2>{staleClient ? "Lock-in has an update" : "This page could not open"}</h2>
          <p>
            {staleClient
              ? "A newer version is ready. Reload to update the app and continue where you left off."
              : "Your account is safe. Try opening this page again, or reload Lock-in if the problem continues."}
          </p>
          <div className="error-actions">
            {staleClient && <button className="btn btn-primary" type="button" onClick={() => { void reloadForUpdate(); }}>Update and reload</button>}
            <button className={staleClient ? "btn btn-soft" : "btn btn-primary"} type="button" onClick={() => this.setState({ hasError: false, error: null })}>Try again</button>
          </div>
        </section>
      );
    }

    return this.props.children;
  }
}
