import { useEffect } from "react";
import { EmptyState, Page } from "../components/ui/index.jsx";
import { useI18n } from "../components/I18nProvider.jsx";

/** The storefront is withheld until commerce launches. The props stay in place
 * so the shell keeps its cart/balance contract, and both are reset on mount. */
export default function Store({ onLockBalanceChange, onCartCountChange }) {
  const { t } = useI18n();

  useEffect(() => {
    onCartCountChange?.(0);
    onLockBalanceChange?.(0);
  }, [onCartCountChange, onLockBalanceChange]);

  return (
    <Page title={t("nav.store")} subtitle={t("store.subtitle")}>
      <EmptyState title={t("store.comingSoon")} text={t("store.comingSoonBody")} />
    </Page>
  );
}
