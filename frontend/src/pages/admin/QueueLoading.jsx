import { useI18n } from "../../components/I18nProvider.jsx";
import { Skeleton, SkeletonText } from "../../components/ui/index.jsx";

/** Match the queue's table/card structure while its first page is loading. */
export function QueueSkeleton() {
  const { t } = useI18n();
  return <section className="panel ops-table-panel ops-queue-skeleton" aria-busy="true" aria-label={t("common.loading")}>
    <span className="visually-hidden" role="status">{t("common.loading")}</span>
    <div className="ops-panel-head" aria-hidden="true"><SkeletonText lines={1} /><Skeleton className="ops-skeleton-count" /></div>
    <div className="ops-skeleton-rows" aria-hidden="true">
      {Array.from({ length: 4 }, (_, index) => <div className="ops-skeleton-row" key={index}>
        <SkeletonText lines={2} />
        {Array.from({ length: 5 }, (_, field) => <Skeleton key={field} />)}
      </div>)}
    </div>
  </section>;
}

/** Reserved space keeps paging/filter refreshes from moving the queue. */
export function QueueRefreshStatus({ refreshing }) {
  const { t } = useI18n();
  return <p className="ops-refresh-status" role="status">{refreshing ? t("common.loading") : ""}</p>;
}
