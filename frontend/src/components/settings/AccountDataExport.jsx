import { useState } from "react";
import { accountsApi } from "../../api/accounts.js";
import { Icon } from "../../lib/icons.jsx";
import { useI18n } from "../I18nProvider.jsx";
import { ErrorPanel } from "../ui/index.jsx";

export default function AccountDataExport() {
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  async function download() {
    if (busy) return;
    setBusy(true); setError(""); setMessage("");
    try {
      const data = await accountsApi.exportPersonalData();
      const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
      const link = document.createElement("a");
      link.href = url; link.download = "lockin-personal-data.json";
      document.body.append(link); link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setMessage(t("settings.exported"));
    } catch (failure) { setError(failure.message); }
    finally { setBusy(false); }
  }
  return <div className="ui-group-block settings-v2-block"><div className="ui-group">
    <button className="ui-row" type="button" disabled={busy} aria-busy={busy || undefined} onClick={() => void download()}><span className="ui-row-icon"><Icon name="package" size={18} /></span><span className="ui-row-body"><strong>{t("settings.exportData")}</strong><small>{t("settings.exportHint")}</small></span><Icon name="chevron-down" size={17} /></button>
  </div>{error && <ErrorPanel message={error} />}{message && <p className="ui-group-footer" role="status">{message}</p>}</div>;
}
