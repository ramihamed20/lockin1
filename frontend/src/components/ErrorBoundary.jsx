import { Component } from "react";
import { isStaleClientError, reloadForUpdate } from "../lib/lazyWithRecovery.js";
import { currentAppLocale, translate } from "../lib/i18n.js";
import { reportClientError } from "../lib/clientErrorReporting.js";

export class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    // React keeps errors it catches away from window.onerror, so the global
    // reporter never saw a crashed page. Report the type and route only.
    if (!isStaleClientError(error)) reportClientError("error", error);
    this.props.onError?.({ error, errorInfo });
  }

  componentDidUpdate(previousProps) {
    // Navigating away from a page that crashed must show the next page, not
    // the same error: the sidebar otherwise looks broken until "Try again".
    if (this.state.hasError && previousProps.resetKey !== this.props.resetKey) {
      this.setState({ hasError: false, error: null });
    }
  }

  render() {
    if (this.state.hasError) {
      const t = (key) => translate(this.props.locale || currentAppLocale(), key);
      const staleClient = isStaleClientError(this.state.error);
      return (
        <section className="panel error-panel app-recovery-panel" role="alert">
          <h2>{t(staleClient ? "errors.boundary.updateTitle" : "errors.boundary.title")}</h2>
          <p>
            {staleClient
              ? t("errors.boundary.updateBody")
              : t("errors.boundary.body")}
          </p>
          <div className="error-actions">
            {staleClient && <button className="btn btn-primary" type="button" onClick={() => { void reloadForUpdate(); }}>{t("errors.boundary.update")}</button>}
            <button className={staleClient ? "btn btn-soft" : "btn btn-primary"} type="button" onClick={() => this.setState({ hasError: false, error: null })}>{t("common.tryAgain")}</button>
          </div>
        </section>
      );
    }

    return this.props.children;
  }
}
