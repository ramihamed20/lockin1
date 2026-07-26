import { useEffect, useState } from "react";
import { Icon } from "../../lib/icons.jsx";

export function InstallPrompt({ deferredPrompt, onInstall, onDismiss }) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (deferredPrompt) {
      // Small timeout for smooth slide-in entry
      const timer = window.setTimeout(() => setVisible(true), 1500);
      return () => window.clearTimeout(timer);
    } else {
      setVisible(false);
    }
  }, [deferredPrompt]);

  if (!visible || !deferredPrompt) return null;

  async function handleInstallClick() {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    console.log(`PWA install prompt outcome: ${outcome}`);
    if (outcome === "accepted") {
      onInstall();
    }
  }

  return (
    <article className="install-prompt-banner" role="alert" aria-live="polite">
      <div className="install-prompt-content">
        <span className="stat-icon pwa-icon">
          <Icon name="sparkles" size={20} />
        </span>
        <div>
          <h2>Install Dentify</h2>
          <p>Add Dentify to your home screen for offline study, instant loading, and focus mode.</p>
        </div>
      </div>
      <div className="install-prompt-actions">
        <button className="btn btn-outline compact" onClick={onDismiss}>
          Later
        </button>
        <button className="btn btn-primary compact" onClick={handleInstallClick}>
          <Icon name="plus" size={16} /> Install App
        </button>
      </div>
    </article>
  );
}
