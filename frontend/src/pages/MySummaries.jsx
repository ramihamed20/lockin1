import { Page } from "../components/ui/index.jsx";
import { useI18n } from "../components/I18nProvider.jsx";
import MySummariesList from "../workspace/summary/MySummariesList.jsx";

/** Materials -> My summaries: every summary the student has written in a sheet. */
export default function MySummaries() {
  const { t } = useI18n();
  return <Page width="reading" title={t("summary.mine")}><MySummariesList /></Page>;
}
